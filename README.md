# Schatzmeister – Reddit Integration

This repository documents the planned Reddit API integration for Schatzmeister, a private and non-commercial Discord bot used by an Aion 2 gaming community.

## Purpose

The integration will use Reddit's API in read-only mode to monitor publicly available posts related to Aion 2.

The bot is intended to identify relevant information such as:

- Official Aion 2 announcements
- Game updates
- Patch notes
- Maintenance information
- Datamining
- Leaks and rumors
- Important bugs or technical issues
- Other significant Aion 2 developments

## Monitored Communities

The integration is intended to monitor selected communities, including:

- r/Aion2
- r/Aion2Hub
- r/aion
- r/MMORPG

Broader gaming communities will only be queried for content specifically related to Aion 2.

## How the Integration Works

The external Discord bot periodically requests publicly available Reddit posts through the Reddit API.

Relevant posts may be analyzed and summarized before being displayed in a private Discord community.

Discord messages will include attribution and a direct link to the original Reddit submission so community members can access the original content and discussion on Reddit.

## Read-Only Access

The integration is strictly intended for read-only access.

It will not:

- Create Reddit posts
- Create comments
- Vote on posts or comments
- Send private messages
- Perform moderation actions
- Interact with Reddit users
- Access private Reddit content

No separate Reddit user account is intended to operate the bot.

## Data Usage

Reddit content is used only to identify and display relevant Aion 2 information within the private Discord community.

The integration is not intended to build datasets, sell Reddit data, profile Reddit users, or use Reddit content for AI model training.

## Project Status

The Reddit integration is currently under development. API access is being requested before implementing the production integration.

The main Schatzmeister Discord bot is privately hosted and its unrelated functionality is not part of this repository.
