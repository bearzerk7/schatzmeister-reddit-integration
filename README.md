# Schatzmeister Discord Bot

Schatzmeister is a private, non-commercial Discord community bot. This public source snapshot is provided to document the existing application and the planned read-only Reddit Data API integration.

## Current functionality

The bot currently contains three independent feature areas:

- DKP management for a Discord gaming community
- Discord polls
- An automated AION 2 news feed

The AION 2 news module periodically checks selected public sources for official announcements, game updates, patch notes, maintenance information and relevant community reports. It classifies content, filters irrelevant items, detects duplicate reports across sources and publishes relevant items as Discord embeds with links to their original sources.

The news system also checks selected public community sources for potential datamining or leak-related reports. Community reports and unconfirmed information are identified separately from official information.

## Planned Reddit Data API integration

Reddit is not currently queried by this source snapshot. Data API access is being requested before the production Reddit integration is implemented.

The planned integration will add Reddit as another input source to the existing AION 2 news pipeline. It is intended to monitor selected public communities such as:

- r/Aion2
- r/Aion2Hub
- r/aion
- r/MMORPG, limited to AION 2-related posts

The integration is intended to retrieve public submissions relevant to AION 2 topics such as official announcements, updates, patch notes, maintenance, important technical issues, datamining and leaks. Relevant submissions may be summarized for a private Discord community while retaining attribution and a direct link to the original Reddit submission.

### Reddit access will be read-only

The bot is not intended to:

- create Reddit posts or comments
- vote on posts or comments
- send private messages
- perform moderation actions
- interact with Reddit users
- access private Reddit content
- build or sell Reddit datasets
- profile Reddit users
- use Reddit content to train AI models

No separate Reddit bot user account is required for these planned read-only operations.

## Data and privacy

Runtime data, Discord IDs, credentials, tokens, API secrets, deployment information and private community data are intentionally excluded from this repository.

Configuration is supplied through environment variables. `.env.example` documents the available settings without containing real credentials or identifiers. Runtime state is stored under `data/`, which is excluded from version control.

## Repository scope

This repository contains a sanitized source snapshot of the existing application so that the purpose and technical context of the requested Reddit Data API access can be reviewed. Private deployment documentation and runtime/community data are not included because they are unrelated to the requested Reddit API functionality.

## Running locally

Requirements:

- Node.js 24 or newer
- a Discord application/bot for local testing

Setup:

1. Run `npm install`.
2. Copy `.env.example` to `.env` and provide your own test credentials and IDs.
3. Register Discord slash commands with `npm run deploy` if required.
4. Start the bot with `npm start`.

The application can run with individual feature areas enabled or disabled through environment variables.
