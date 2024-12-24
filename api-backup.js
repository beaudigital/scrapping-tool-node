// Import necessary modules
const express = require("express");
const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const zlib = require("zlib");

const config = require("./config");
const app = express();

const process = require("process");

const protocol = process.env.NODE_ENV === "production" ? "https" : "http";

// Define SSL options for HTTPS server
let sslOptions = {};
if (protocol === "https") {
  const sslCertPath = "certificates/fullchain.pem";
  const sslKeyPath = "certificates/privkey.pem";

  sslOptions = {
    cert: fs.readFileSync(sslCertPath),
    key: fs.readFileSync(sslKeyPath),
  };
}

// Set up server port
const port = process.env.PORT || 3000;
const server =
  protocol === "https"
    ? https.createServer(sslOptions, app)
    : http.createServer(app);

// Use garbage collection to manage memory
let browser; // Define browser variable in a higher scope

// Function to scroll the page to load all reviews
const scrollPage = async (page, scrollContainer, totalReviewsSelector) => {
  try {
    await page.waitForSelector(totalReviewsSelector);
    const totalReviewsElement = await page.$(totalReviewsSelector);
    const totalReviewsText = await page.evaluate(
      (totalReviewsElement) => totalReviewsElement.textContent,
      totalReviewsElement
    );
    const totalReviews = parseInt(totalReviewsText.replace(/\D/g, "")); // Remove non-numeric characters

    console.log("Total reviews:", totalReviews);

    console.log("Scrolling page ...");
    await page.waitForSelector(scrollContainer);

    let reviewsScrapped = 0; // Counter to track total reviews scrapped
    const batchSize = 5; // Number of scroll actions to perform in parallel

    while (reviewsScrapped < totalReviews) {
      // Perform batch scroll actions in parallel
      const scrollActions = Array.from({ length: batchSize }, async () => {
        await page.evaluate(
          `(async () => {
            document.querySelector("${scrollContainer}").scrollTo(0, document.querySelector("${scrollContainer}").scrollHeight);
            await new Promise(resolve => setTimeout(resolve, 100)); // Reduce delay between scrolls
          })()`
        );
      });

      await Promise.all(scrollActions); // Wait for all scroll actions to complete

      // Wait for new reviews to appear after scrolling
      await page.waitForFunction(
        (scrollContainer, reviewsScrapped) => {
          const container = document.querySelector(scrollContainer);
          const reviews = container.querySelectorAll(
            ".WMbnJf.vY6njf.gws-localreviews__google-review"
          );
          return reviews.length > reviewsScrapped;
        },
        { timeout: 10000 }, // Increase timeout if necessary
        scrollContainer,
        reviewsScrapped
      );

      // Update the number of scraped reviews
      const newReviewsCount = await page.$$eval(
        ".WMbnJf.vY6njf.gws-localreviews__google-review",
        (elements) => elements.length
      );
      reviewsScrapped = newReviewsCount;

      console.log(`Scrolled ${reviewsScrapped}/${totalReviews}`); // Log the scrolling progress
    }
  } catch (error) {
    console.warn("Warning: Error during scrolling.", error.message);
    throw new Error("Error scrolling page");
  }
};

// Function to extract Google reviews with timeout and retry logic
const getGoogleReviewsWithTimeoutAndRetry = async (page, firm) => {
  try {
    const maxRetries = 3;
    let retryCount = 0;
    let googleReviewsData;

    while (retryCount < maxRetries) {
      try {
        console.log("Scraping Google Reviews...");
        const startTime = performance.now();

        await scrollPage(page, ".review-dialog-list", ".hqzQac a span");

        // Extract review data
        googleReviewsData = await page.$$eval(
          ".gws-localreviews__google-review",
          (reviews) =>
            Promise.all(
              reviews.map(async (review) => {
                try {
                  const titleElem = review.querySelector(".TSUbDb a");
                  const ratingElem = review.querySelectorAll(".lTi8oc.z3HNkc");
                  const reviewerPictureElem = review.querySelector(".lDY1rd");

                  if (!titleElem || ratingElem.length === 0)
                    throw new Error("Missing required element");

                  const title = titleElem.textContent.trim();
                  const numericRatingCount = parseFloat(
                    ratingElem[0]
                      .getAttribute("aria-label")
                      .replace("Rated ", "")
                      .replace(" out of 5,", "")
                  );
                  if (isNaN(numericRatingCount))
                    throw new Error("Failed to extract numeric rating count");

                  const reviewerPictureUrl = reviewerPictureElem
                    ? reviewerPictureElem.getAttribute("src")
                    : null;
                  const moreBtn = review.querySelector(".review-more-link");
                  let description = null;

                  if (moreBtn) {
                    await moreBtn.click();
                    const expandedDescElem = review.querySelector(
                      ".f5axBf .review-full-text"
                    );
                    description = expandedDescElem
                      ? expandedDescElem.textContent.trim()
                      : null;
                  } else {
                    const spanDescElem = review.querySelector(
                      ".Jtu6Td span[data-expandable-section]"
                    );
                    description = spanDescElem
                      ? spanDescElem.textContent.trim()
                      : null;
                  }

                  const reviewerUrlElem = review.querySelector(".TSUbDb a");
                  const reviewerUrl_get = reviewerUrlElem
                    ? reviewerUrlElem.getAttribute("href").replace(/\?.*$/, "")
                    : null;
                  const reviewerUrl = reviewerUrl_get + "/reviews/";
                  const id = reviewerUrl_get
                    ? reviewerUrl_get.split("/").pop()
                    : null;

                  const dateElem = review.querySelector(".dehysf.lTi8oc");
                  const publicationDate = dateElem
                    ? dateElem.textContent.trim()
                    : null;

                  return {
                    id,
                    title,
                    description,
                    numericRatingCount,
                    reviewerPictureUrl,
                    reviewerUrl,
                    publicationDate,
                  };
                } catch (error) {
                  console.error(
                    "Error during review processing:",
                    error.message
                  );
                  return null;
                }
              })
            )
        );

        // Filter out null reviews
        googleReviewsData = googleReviewsData.filter(
          (review) => review !== null
        );

        // Calculate scraping time
        const endTime = performance.now();
        const elapsedTimeSeconds = (endTime - startTime) / 1000; // Convert milliseconds to seconds
        const roundedElapsedTime = elapsedTimeSeconds.toFixed(2); // Round to one decimal place
        console.log(`Scraping completed in ${roundedElapsedTime} seconds`);

        break; // Break out of retry loop if successful
      } catch (error) {
        console.error("Error during Google Reviews extraction:", error.message);
        retryCount++;
        if (retryCount < maxRetries) {
          console.log(
            `Retrying Google Reviews extraction (Retry ${retryCount})...`
          );
          // Retry after a delay
          await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait for 5 seconds before retrying
        } else {
          throw new Error(
            "Max retries reached. Unable to extract Google Reviews."
          );
        }
      }
    }

    return googleReviewsData;
  } catch (error) {
    console.error("Error during Google Reviews extraction:", error.message);
    throw new Error("Error during Google Reviews extraction");
  }
};

// Middleware for parsing request body
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Middleware for validating API key
const validateApiKey = (providedApiKey) =>
  providedApiKey === (process.env.API_KEY || config.apikey);

// API endpoint for extracting Google reviews
app.post("/api/free-google-reviews", async (req, res) => {
  try {
    // Validate API key and extract firm name from request body
    const providedApiKey = req.headers.apikey;
    if (!validateApiKey(providedApiKey)) {
      console.log("Invalid API Key requested");
      return res
        .status(401)
        .json({ success: 0, api: 0, message: "Invalid API Key requested" });
    }
    const firm = req.body.firm;
    if (!firm) {
      console.log("Firm Name cannot be blank.");
      return res.status(400).json({
        success: 0,
        firm_name: firm,
        message: "Firm Name cannot be blank.",
        totalCount: 0,
        reviews: [],
      });
    }

    console.log("Launching Puppeteer...");
    // Launch Puppeteer browser
    browser = await puppeteer.launch({
      headless: true, // Optimized for performance
    });
    const page = await browser.newPage();

    console.log("Setting geolocation ...");
    // Emulate the location to appear as if the request is coming from India
    await page.setGeolocation({ latitude: 20.5937, longitude: 78.9629 });

    console.log("Navigating to Google...");
    await page.goto("https://www.google.com/", { timeout: 30000 }); // 30 seconds timeout for page navigation
    await page.waitForSelector("textarea");
    await page.type("textarea", firm);
    await page.keyboard.press("Enter");

    const linkFound = await page
      .waitForSelector(".hqzQac a", { visible: true, timeout: 15000 })
      .then(() => true)
      .catch(() => false);

    if (!linkFound) {
      console.log("Business Account Does Not Exist!");
      const notFoundResponse = {
        success: 0,
        firm_name: firm,
        message: "Business Account Does Not Exist!",
        totalCount: 0,
        reviews: [],
      };

      return res.json(notFoundResponse);
    }

    const link = await page.$(".hqzQac a");
    await link.click();
    await page.waitForNavigation({
      waitUntil: "domcontentloaded",
      timeout: 30000,
    }); // 30 seconds timeout for page navigation

    const googleReviewsData = await getGoogleReviewsWithTimeoutAndRetry(
      page,
      firm
    );

    const jsonContent = JSON.stringify(googleReviewsData);
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Encoding", "gzip");
    zlib.gzip(jsonContent, (err, gzipResult) => {
      if (err) {
        console.error("Error compressing response:", err);
        return res
          .status(500)
          .json({ success: 0, message: "Internal Server Error" });
      }
      res.end(gzipResult);
    });
  } catch (error) {
    console.error("Error during Free Google Reviews:", error);
    res.status(500).json({ success: 0, message: "Internal Server Error" });
  } finally {
    console.log("Closing browser...");
    if (browser) {
      await browser.close();
    }
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Error occurred:", err);
  if (browser) {
    browser
      .close()
      .then(() => {
        console.log("Browser closed successfully.");
        res.status(500).json({ success: 0, message: "Internal Server Error" });
      })
      .catch((closeError) => {
        console.error("Error closing browser:", closeError);
        res.status(500).json({ success: 0, message: "Internal Server Error" });
      });
  } else {
    res.status(500).json({ success: 0, message: "Internal Server Error" });
  }
});

// Start server
server.listen(port, () => {
  console.log(`${protocol.toUpperCase()} Server is running on port ${port}`);
});
