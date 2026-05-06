# DocuEase — Deployment Guide

## Prerequisites

- A [GitHub](https://github.com) account (free)
- A [Render.com](https://render.com) account (free)
- A [MongoDB Atlas](https://cloud.mongodb.com) account (free tier)
- A Telegram account + a Bot (see Step 1)

---

## Step 1 — Create Your Telegram Bot & Get Your Chat ID

### Create the Bot
1. Open Telegram and search for **@BotFather**
2. Send `/newbot` and follow the prompts
3. Copy the **Bot Token** it gives you (looks like `123456789:ABCdefGhI...`)

### Get Your Chat ID
1. Start a chat with your new bot (send it any message)
2. Visit this URL in your browser (replace `YOUR_TOKEN`):
   ```
   https://api.telegram.org/botYOUR_TOKEN/getUpdates
   ```
3. Find the `"id"` number inside `"chat"` — that is your **Chat ID**
4. For a private channel: add the bot as Admin, then the Chat ID starts with `-100...`

---

## Step 2 — Set Up MongoDB Atlas

1. Go to [cloud.mongodb.com](https://cloud.mongodb.com) → **Create a free account**
2. Create a **Free Shared Cluster** (M0 tier)
3. Choose a cloud provider (AWS/GCP/Azure) and a region close to you
4. Under **Database Access** → Add a new user with username + password
5. Under **Network Access** → Add IP `0.0.0.0/0` (allow all — required for Render)
6. Go to **Clusters** → **Connect** → **Connect your application**
7. Copy the connection string:
   ```
   mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/docuease?retryWrites=true&w=majority
   ```
   Replace `<username>` and `<password>` with your database user credentials.

---

## Step 3 — Push Code to GitHub

1. Create a new **private** repository on GitHub (e.g., `docuease`)
2. In your project folder, run:
   ```bash
   git init
   git add .
   git commit -m "Initial DocuEase setup"
   git remote add origin https://github.com/YOUR_USERNAME/docuease.git
   git push -u origin main
   ```

---

## Step 4 — Deploy to Render.com

1. Go to [render.com](https://render.com) → **New** → **Web Service**
2. Connect your GitHub account and select the `docuease` repository
3. Configure the service:

   | Setting | Value |
   |---------|-------|
   | **Name** | `docuease` |
   | **Region** | Choose the closest to you |
   | **Branch** | `main` |
   | **Runtime** | `Node` |
   | **Build Command** | `npm install` |
   | **Start Command** | `npm start` |
   | **Plan** | Free |

4. Scroll down to **Environment Variables** and add:

   | Key | Value |
   |-----|-------|
   | `MONGODB_URI` | Your Atlas connection string |
   | `TELEGRAM_BOT_TOKEN` | Your bot token |
   | `TELEGRAM_CHAT_ID` | Your chat ID |
   | `NODE_ENV` | `production` |

5. Click **Create Web Service** — Render will build and deploy automatically

6. After 2–3 minutes, your app will be live at:
   ```
   https://docuease.onrender.com
   ```
   (or whatever name you chose)

---

## Step 5 — Install LibreOffice on Render (for PDF conversion)

Render's free instances run Ubuntu and support LibreOffice. Add this to your **Build Command**:

```
apt-get install -y libreoffice && npm install
```

> **Note:** If Render does not allow `apt-get` in the build command, create a `render.yaml` file in your project root:

```yaml
services:
  - type: web
    name: docuease
    env: node
    buildCommand: npm install
    startCommand: npm start
    envVars:
      - key: MONGODB_URI
        sync: false
      - key: TELEGRAM_BOT_TOKEN
        sync: false
      - key: TELEGRAM_CHAT_ID
        sync: false
    dockerfilePath: ./Dockerfile
```

And create a `Dockerfile`:

```dockerfile
FROM node:20-slim

# Install LibreOffice for PDF conversion
RUN apt-get update && apt-get install -y \
    libreoffice \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .

EXPOSE 3000
CMD ["node", "server.js"]
```

Then push this to GitHub and Render will use Docker automatically.

---

## Step 6 — Test Your Deployment

1. Open your Render URL in a browser
2. Upload a `.docx` file with `{name}`, `{date}`, `{address}` placeholders
3. Fill in the form and click **Generate Documents**
4. Download your filled `.docx` and `.pdf`
5. Check your Telegram chat — you should see the template file was saved there

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| PDF not generating | Make sure LibreOffice is installed (use Dockerfile approach) |
| Telegram upload fails | Check that your bot token and chat ID are correct; ensure bot has permission to send files in the chat |
| MongoDB connection error | Check your Atlas IP whitelist (add `0.0.0.0/0`) and verify credentials in the connection string |
| App crashes on free tier | Free Render instances sleep after 15 min — first request takes ~30 seconds to wake up |

---

## How It Works (Summary)

```
User uploads .docx
      ↓
Server scans for {placeholders}
      ↓
User fills form (or uploads CSV)
      ↓
docxtemplater fills the template
      ↓
LibreOffice converts to PDF
      ↓
Files returned to browser for download
      ↓
Template saved to Telegram (storage) + MongoDB (metadata)
```

---

## File Structure

```
docuease/
├── server.js              ← Express server & all API routes
├── package.json
├── .env.example           ← Copy to .env and fill in
├── models/
│   └── Template.js        ← Mongoose schema
├── services/
│   ├── telegram.js        ← Upload/download via Telegram Bot API
│   └── processor.js       ← Field extraction, fill, PDF convert, CSV parse
└── public/
    ├── index.html         ← The entire UI
    ├── style.css          ← Father-friendly styling
    └── app.js             ← Frontend logic
```
