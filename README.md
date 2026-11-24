# Pin Inspector Web Pro

Pin Inspector Web Pro is a complete Pinterest intelligence, trends analysis, and research suite.

## Features

- **Keyword & Trends Search**: Search Pinterest keywords and analyze historical search trends and popular queries.
- **Top Pins Analysis**: Harvest and rank top pins, outbound links, repins, and saves.
- **Board & User Explorer**: Inspect boards, categories, and user profiles.
- **Annotations & Visual Intelligence**: Explore visual annotations, related products, and image lookups.
- **Integrated REST API & Swagger**: Full documentation available via `swagger.json`.

## Quick Start

### 1. Prerequisites
- Node.js (v18 or higher recommended)
- npm

### 2. Installation
```bash
npm install
```

### 3. Running the Server
```bash
npm start
```

By default, the server runs on `http://localhost:3000` (or the port defined in the `PORT` environment variable). Open your browser and navigate to `http://localhost:3000`.

## Project Structure

```text
pininspector/
├── package.json        # Project metadata and dependencies
├── package-lock.json   # Exact dependency locks
├── server.js           # Express API and backend routes
├── swagger.json        # OpenAPI / Swagger specification
├── public/             # Frontend client assets
│   ├── index.html      # UI layout and styling
│   └── app.js          # Client-side logic, charts, and API interactions
├── .gitignore          # Git exclusion rules
└── README.md           # Documentation
```

## Synchronizing with GitHub

To push this project to a new GitHub repository:

```bash
cd pininspector
git init
git add .
git commit -m "Initial commit of Pin Inspector"
git branch -M main
git remote add origin https://github.com/<YOUR-USERNAME>/pininspector.git
git push -u origin main
```
