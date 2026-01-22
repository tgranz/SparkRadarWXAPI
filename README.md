# SparkRadarWXAPI

## About
A simple NodeJS Express backend to [SparkRadarWX](https://github.com/tgranz/sparkradarwx).

## Purpose
To proxy and fetch data from various sources and parse and reformat the data faster than the mobile app can. Cuts down on networking traffic from unnecessary parameters in the response and provides data in a simpler format.

## Run
- Install NodeJS on your machine if you don't already have it.
- Clone or download this repository.
- Run `npm install` to install dependencies.
- Create a `.env` file in the following format, filling out data pertaining to your credentials:
```text
# Port number for the server to listen on
PORT=3000

# API key for accessing the server
API_KEY=testapikey12345

# Logging level (debug, info, warn, error)
LOG_LEVEL=debug

# API Key for OpenWeatherMap
OWM_API_KEY=XXXXXXXXXXXX

```
- Run the server with `node index`.
- The following output is normal:
```text
[dotenv@17.2.3] injecting env (4) from .env
[dotenv@17.2.3] injecting env (0) from .env
OWM API key initialized as XXXX****
SparkRadarWXAPI running on port http://localhost:{3000}
```
- Any errors will not post in console, but rather in a app.log file. The file holds no more than 1000 logs and places newest logs at the top.