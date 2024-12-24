// Import necessary modules
const express = require("express");
const http = require("http");
const https = require("https");
const fs = require("fs");
const zlib = require("zlib");
const puppeteer = require("puppeteer");
const { createPool } = require("generic-pool");
const rateLimit = require("express-rate-limit");
const winston = require("winston");
const { getServerLoad } = require("./serverLoad");

// Create an Express app
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configure logging
const logger = winston.createLogger({
  level: "error",
  format: winston.format.json(),
  transports: [new winston.transports.File({ filename: "error.log" })],
});

// Determine protocol and SSL options based on environment
const protocol = process.env.NODE_ENV === "production" ? "https" : "http";
const sslOptions =
  protocol === "https"
    ? {
        cert: fs.readFileSync("certificates/fullchain.pem"),
        key: fs.readFileSync("certificates/privkey.pem"),
      }
    : {};

// Set port for the server
const port = process.env.PORT || 3000;

// Create HTTP or HTTPS server based on protocol
const server =
  protocol === "https"
    ? https.createServer(sslOptions, app)
    : http.createServer(app);

// Create a pool of Puppeteer browser instances
const browserPool = createBrowserPool();

// Define the number of reviews and window duration for rate limiting
const reviewsCount = 2800;
const windowDurationInMinutes = 1;

// Setup rate limiter middleware
const limiter = setupRateLimiter(reviewsCount, windowDurationInMinutes);
app.use("/api/free-google-reviews", limiter);

// Define route for handling POST requests to fetch Google reviews
app.post("/api/free-google-reviews", handleFreeGoogleReviews);

// Start the server
server.listen(port, () => {
  console.log(`${protocol.toUpperCase()} Server is running on port ${port}`);
});

// Function to handle fetching Google reviews
async function handleFreeGoogleReviews(req, res) {
  try {
    console.log("================== START SCRAPPING ==================");
    const startTime = process.hrtime.bigint();
    const config = require("./config");
    const providedApiKey = req.headers.apikey;

    // Validate API key
    if (!validateApiKey(providedApiKey, config)) {
      return sendErrorResponse(res, 401, "Invalid API Key requested");
    }

    // Check if firm name is provided
    if (!req.body || !req.body.firm) {
      return sendErrorResponse(res, 400, "Firm Name cannot be blank.");
    }

    const firm = req.body.firm;
    const page = await setupBrowserPage();

    // Search for the firm on Google and navigate to its page
    await searchFirmAndNavigate(page, firm, res);
    const totalReviews = await extractTotalReviews(page);
    const { batchSize, scrollThreshold } = calculateBatchAndScroll(
      totalReviews
    );
    const googleReviewsData = await scrapeGoogleReviews(
      page,
      firm,
      batchSize,
      scrollThreshold
    );

    // Check if the client provided If-Modified-Since header
    const ifModifiedSince = req.header("If-Modified-Since");
    const lastModified = new Date(); // Set your last modified date here

    // Compare If-Modified-Since and Last-Modified headers
    if (ifModifiedSince && lastModified <= new Date(ifModifiedSince)) {
      // Respond with 304 Not Modified
      return res.status(304).send();
    }

    // Compress and send the reviews data
    const jsonContent = JSON.stringify(googleReviewsData);
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Encoding", "gzip");
    res.setHeader("Last-Modified", lastModified.toUTCString());
    zlib.gzip(jsonContent, (err, gzipResult) => {
      if (err) {
        console.error("Error compressing response:", err);
        return res
          .status(500)
          .json({ success: 0, message: "Internal Server Error" });
      }
      res.end(gzipResult);

      // Log server load after sending response
      setTimeout(() => {
        getServerLoad(startTime);
      }, 1000);
    });

    console.log("Total Reviews Scrapped = " + googleReviewsData.reviews.length);
    browserPool.release(page.browser());
  } catch (error) {
    console.error("Error during Free Google Reviews:", error);
    logger.error("Error during Free Google Reviews:", { error: error.message });
    return sendErrorResponse(res, 500, "Internal Server Error");
  }
}

// Function to create a pool of Puppeteer browser instances
function createBrowserPool() {
  return createPool(
    {
      create: createBrowserInstance,
      destroy: destroyBrowserInstance,
    },
    { min: 1, max: 10 }
  );
}

// Function to setup a new browser page
async function setupBrowserPage() {
  const browser = await browserPool.acquire();
  return browser.newPage();
}

// Function to search for a firm on Google and navigate to its page
async function searchFirmAndNavigate(page, firm, res) {
  await page.goto("https://www.google.com/", { timeout: 15000 });
  await page.waitForSelector("textarea", { timeout: 5000 });
  await page.type("textarea", firm);
  await page.keyboard.press("Enter");
  // await page.waitForSelector(".hqzQac a", { visible: true, timeout: 10000 });

  // Check if link is found
  const linkFound = await page
    .waitForSelector(".hqzQac a", { visible: true, timeout: 5000 })
    .then(() => true)
    .catch(() => false);

  if (!linkFound) {
    console.log("Business Account Does Not Exist!");
    browserPool.release(page.browser());
    return sendErrorResponse(res, 404, "Business Account Does Not Exist!");
  }

  const link = await page.$(".hqzQac a");
  await link.click();
  await page.waitForNavigation({
    waitUntil: "domcontentloaded",
    timeout: 2000,
  });
}

// Function to extract total reviews count from the page
async function extractTotalReviews(page) {
  const totalReviewsData = await page.waitForSelector(".hqzQac a span");
  const totalReviewsText = await page.evaluate(
    (el) => el.textContent,
    totalReviewsData
  );
  return parseInt(totalReviewsText.replace(/\D/g, ""));
}

// Function to calculate batch size and scroll threshold based on total reviews
function calculateBatchAndScroll(totalReviews) {
  let batchSize = 1;
  let scrollThreshold = 10;

  if (totalReviews > 500) {
    batchSize = Math.ceil(totalReviews / 25);
    scrollThreshold = batchSize * 2;
  } else if (totalReviews > 100) {
    batchSize = Math.ceil(totalReviews / 20);
    scrollThreshold = batchSize * 2;
  } else if (totalReviews > 20) {
    batchSize = Math.ceil(totalReviews / 10);
    scrollThreshold = batchSize * 1;
  }

  return { batchSize, scrollThreshold };
}

// Function to scrape Google reviews
async function scrapeGoogleReviews(page, firm, batchSize, scrollThreshold) {
  try {
    const total_reviews = await scrollPageWithRetry(
      page,
      ".review-dialog-list",
      ".hqzQac a span",
      firm,
      batchSize,
      scrollThreshold
    );
    return {
      success: total_reviews.reviews.length > 0 ? 1 : 0,
      firm_name: firm,
      message: "Google Reviews Successfully Extracted.",
      totalCount: total_reviews.reviews.length,
      reviews: total_reviews.reviews,
    };
  } catch (error) {
    console.error("Error during Google Reviews scraping:", error.message);
    logger.error("Error during Google Reviews scraping:", {
      error: error.message,
    });
    throw new Error("Error scraping Google Reviews");
  }
}

// Function to send error response
function sendErrorResponse(res, statusCode, message) {
  return res.status(statusCode).json({ success: 0, message });
}

// Function to create a new Puppeteer browser instance
async function createBrowserInstance() {
  return await puppeteer.launch({
    headless: true,
    timeout: 0,
    defaultViewport: null,
    slowMo: 0,
    ignoreHTTPSErrors: true,
    devtools: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-web-security', // disabling CORS
      '--disable-site-isolation-trials',
      "--disable-notifications", // to disable native notification window on Mac OS 
      "--no-zygote", // Seems to help avoid zombies https://github.com/puppeteer/puppeteer/issues/1825      
    ],
  });
}

// Function to destroy a Puppeteer browser instance
async function destroyBrowserInstance(browser) {
  await browser.close();
}

// Function to validate API key
const validateApiKey = (providedApiKey, config) =>
  providedApiKey === (process.env.API_KEY || config.apikey);

// Function to setup rate limiter middleware
function setupRateLimiter(reviewsCount, windowDurationInMinutes) {
  const batchSize = calculateBatchSize(reviewsCount);

  const requestsNeeded = Math.ceil(reviewsCount / batchSize);
  const windowDuration = windowDurationInMinutes * 60 * 1000; // Convert minutes to milliseconds
  const maxRequestsPerWindow = requestsNeeded;

  return rateLimit({
    windowMs: windowDuration,
    max: maxRequestsPerWindow,
    message: "Too many requests from this IP, please try again later",
  });
}

// Function to calculate batch size based on total reviews
// Function to calculate batch size based on total reviews
function calculateBatchSize(totalReviews) {
  if (totalReviews > 500) {
    return Math.ceil(totalReviews / 25);
  } else if (totalReviews > 100) {
    return Math.ceil(totalReviews / 20);
  } else if (totalReviews > 20) {
    return Math.ceil(totalReviews / 10);
  } else {
    return 1;
  }
}

// Function to scroll the page with retry mechanism
async function scrollPageWithRetry(
  page,
  scrollContainer,
  totalReviewsSelector,
  firm,
  batchSize,
  scrollThreshold
) {
  try {
    // Wait for the total reviews element to appear
    await page.waitForSelector(totalReviewsSelector, { timeout: 90000 });
    const totalReviewsElement = await page.$(totalReviewsSelector);
    const totalReviewsText = await page.evaluate(
      (totalReviewsElement) => totalReviewsElement.textContent,
      totalReviewsElement
    );
    const totalReviews = parseInt(totalReviewsText.replace(/\D/g, ""));

    console.log("Total reviews:", totalReviews);
    console.log("Scrolling page ...");
    await page.waitForSelector(scrollContainer);

    let reviewsScrapped = 0;
    let pauseIntervalCounter = 0;
    let total_reviews = {};

    // Scroll the page and fetch reviews until all reviews are scraped
    while (reviewsScrapped < totalReviews) {
      const remainingReviews = totalReviews - reviewsScrapped;
      const currentBatchSize =
        remainingReviews < batchSize ? remainingReviews : batchSize;

      for (let i = 0; i < currentBatchSize; i++) {
        await scrollPage(page, scrollContainer);

        pauseIntervalCounter++;
        if (pauseIntervalCounter % 100 === 0) {
          console.log(
            `Pausing for memory management (${pauseIntervalCounter} reviews scrolled)...`
          );
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      reviewsScrapped += currentBatchSize;
      console.log(`Scrolled ${reviewsScrapped}/${totalReviews}`);
      console.log("remaining reviews = " + remainingReviews);

      await new Promise((resolve) => setTimeout(resolve, 100));

      if (
        reviewsScrapped % scrollThreshold === 0 ||
        reviewsScrapped >= totalReviews
      ) {
        console.log("Fetching data...");
        total_reviews = await getGoogleReviewsWithTimeoutAndRetry(page, firm);
        scrollThreshold += batchSize;
      }

      if (pauseIntervalCounter >= 100) {
        pauseIntervalCounter = 0;
        console.log("<------pauseIntervalCounter------->");
      }
    }
    return total_reviews;
  } catch (error) {
    console.warn("Warning: Error during scrolling.", error.message);
    logger.error("Error during scrolling:", { error: error.message });
    throw new Error("Error scrolling page");
  }
}

// Function to scroll the page
async function scrollPage(page, scrollContainer) {
  await page.evaluate(
    `(async () => {
      document.querySelector("${scrollContainer}").scrollTo(0, document.querySelector("${scrollContainer}").scrollHeight);
      await new Promise(resolve => setTimeout(resolve, 50));
    })()`
  );
}

// Function to fetch Google reviews with timeout and retry
async function getGoogleReviewsWithTimeoutAndRetry(page, firm) {
  try {
    const googleReviewsData = await page.$$eval(
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
              console.warn(
                "Warning: Error extracting review data.",
                error.message
              );
              return null;
            }
          })
        )
    );

    const filteredReviews = googleReviewsData.filter(
      (review) => review !== null
    );

    return {
      success: filteredReviews.length > 0 ? 1 : 0,
      firm_name: firm,
      message: "Google Reviews Successfully Extracted.",
      totalCount: filteredReviews.length,
      reviews: filteredReviews,
    };
  } catch (error) {
    console.error("Error during Google Reviews extraction:", error.message);
    logger.error("Error during Google Reviews extraction:", {
      error: error.message,
    });
    throw new Error("Error extracting Google Reviews");
  }
}