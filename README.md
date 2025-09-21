![Logo](admin/unraid.png)

# ioBroker.unraid

[![NPM version](https://img.shields.io/npm/v/iobroker.unraid.svg)](https://www.npmjs.com/package/iobroker.unraid)
[![Downloads](https://img.shields.io/npm/dm/iobroker.unraid.svg)](https://www.npmjs.com/package/iobroker.unraid)
![Number of Installations](https://iobroker.live/badges/unraid-installed.svg)
![Current version in stable repository](https://iobroker.live/badges/unraid-stable.svg)

[![NPM](https://nodei.co/npm/iobroker.unraid.png?downloads=true)](https://nodei.co/npm/iobroker.unraid/)

**Tests:** ![Test and Release](https://github.com/ingel81/ioBroker.unraid/workflows/Test%20and%20Release/badge.svg)

## unraid adapter for ioBroker

This adapter connects ioBroker to Unraid servers via the GraphQL API to monitor system metrics and status.

## Features

- Monitor CPU and memory usage
- Track server status and network information
- View system time and operating system details
- Support for self-signed certificates
- Configurable polling interval

## Configuration

1. **Base URL**: Enter your Unraid server address (e.g., `https://192.168.1.10` or `https://tower.local`)
2. **API Token**: Generate an API token in your Unraid web UI settings and paste it here
3. **Polling Interval**: Set how often to fetch data (default: 60 seconds)
4. **Self-signed Certificates**: Enable if your Unraid server uses a self-signed HTTPS certificate
5. **Data Domains**: Select which data categories to monitor (System Info, Server Status, Metrics, etc.)

## Requirements

- Unraid server with GraphQL API enabled
- API token generated in Unraid web UI
- Network access from ioBroker to Unraid server

## Changelog
### 0.4.0 (2025-09-21)

- (ingel81) Adapter renamed to iobroker.unraid

### 0.3.0 (2025-09-21)

- (ingel81) Translations
- (ingel81) Logo
- (ingel81) Readme

### 0.2.2 (2025-09-21)

- (ingel81) Release testing with npm, reloaded2

## License

MIT License

Copyright (c) 2025 ingel81 <ingel81@sgeht.net>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
