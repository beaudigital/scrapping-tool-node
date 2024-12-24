███╗   ██╗ ██████╗ ██████╗ ███████╗     █████╗ ██████╗ ██╗
████╗  ██║██╔═══██╗██╔══██╗██╔════╝    ██╔══██╗██╔══██╗██║
██╔██╗ ██║██║   ██║██║  ██║█████╗      ███████║██████╔╝██║
██║╚██╗██║██║   ██║██║  ██║██╔══╝      ██╔══██║██╔═══╝ ██║
██║ ╚████║╚██████╔╝██████╔╝███████╗    ██║  ██║██║     ██║
╚═╝  ╚═══╝ ╚═════╝ ╚═════╝ ╚══════╝    ╚═╝  ╚═╝╚═╝     ╚═╝
                                                          
Free Google Reviews API

Overview
The Free Google Reviews API is a tool for developers, designed to seamlessly access Google Reviews data for any business listed on Google. Developed by @beaubhavik, this API is tailored for easy integration into various environments.

Features
- Free for Life: Comes with a lifetime free API key, no expiration date
- Unlimited Use: Retrieve Google Reviews for any business name available on Google
- Developer-Friendly: Tailored for easy integration into various applications

Accessing the API

Using Postman
1. Open Postman.
2. Set the request type to POST.
3. Enter the API URL: https://api.spiderdunia.com/.
4. In the request body, include the following parameters:
    - apiKey: Your API key (Mandatory).
    - firmName: The name of the business to retrieve reviews for (Mandatory).

API Response
The API will respond with a JSON object containing Google Reviews data.

How to run with initially.
Local Development
- For local development: `npm run start-local`

Live Environments
- For live environment with HTTP: `npm run start-live-http`
- For live environment with HTTPS: `npm run start-live-https`

Disclaimer
This API is intended for development purposes and is provided for educational and informational use only. Use it responsibly and ensure compliance with the terms of service of the websites you interact with.

Contributing
If you'd like to contribute to the development of this API, please fork the repository and create a pull request. We welcome any contributions that improve the functionality and usability of the API.

Support
For questions or support, please open an issue in the plugin GitHub repository.


===========

Useful commands : 

To run your application using PM2 with the provided ecosystem configuration file and npm scripts, you can use the following commands:

(1) Start the application in production mode:
npm start

(2) Start the application in development mode:
npm run start-dev

(3) Restart the application in production mode:
npm run restart

(4) Restart the application in development mode:
npm run restart-dev

(5) Stop the application:
npm run stop

(6) Stop the application in development mode:
npm run stop-dev

(7) Start the application for debugging (without PM2 daemon):
npm run debug-start

(8) Restart the application for debugging (without PM2 daemon):
npm run debug-restart

