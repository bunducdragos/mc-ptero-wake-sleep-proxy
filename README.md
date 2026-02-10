# Minecraft Wake-on-Join Proxy

A smart proxy server that automatically wakes up your Minecraft server when players try to join, and shuts it down after a period of inactivity.

## Features

- 🔌 **Wake-on-Join**: Automatically starts your Pterodactyl-hosted Minecraft server when players connect
- 💤 **Auto-Shutdown**: Stops the server after configurable idle time (default: 20 minutes)
- 📊 **Custom MOTD**: Shows different status messages based on server state (sleeping/starting/running)
- 🔄 **Transparent Proxy**: Raw TCP proxy when server is running - no protocol interference
- 🛡️ **Rate Limiting**: Prevents spam-starting with configurable cooldown

## Quick Start

### Using Docker (Recommended)

1. Copy `.env.example` to `.env` and configure your settings:

```bash
cp .env.example .env
```

2. Edit `.env` with your Pterodactyl and Minecraft server details

3. Start the proxy:

```bash
docker-compose up -d
```

### Using Node.js

1. Install dependencies:

```bash
npm install
```

2. Create `.env` file with your configuration

3. Start the proxy:

```bash
npm start
```

## Configuration

All configuration is done via environment variables in the `.env` file:

| Variable                | Description                  | Default     |
| ----------------------- | ---------------------------- | ----------- |
| `LISTEN_PORT`           | Proxy listening port         | `25565`     |
| `BACKEND_HOST`          | Minecraft server IP          | `127.0.0.1` |
| `BACKEND_PORT`          | Minecraft server port        | `25566`     |
| `PTERO_PANEL`           | Pterodactyl Panel URL        | Required    |
| `PTERO_SERVER_ID`       | Pterodactyl Server ID        | Required    |
| `PTERO_API_KEY`         | Pterodactyl Client API Key   | Required    |
| `IDLE_SHUTDOWN_MINUTES` | Minutes before auto-shutdown | `20`        |

### Getting Your Pterodactyl API Key

1. Log into your Pterodactyl Panel
2. Go to Account Settings → API Credentials
3. Create a new **Client API Key** (not Application key)
4. Copy the key starting with `ptlc_`

### Multi-Server Setup

To run multiple Minecraft servers, create separate directories for each:

```bash
minecraft-wake/
├── server1/
│   ├── .env
│   ├── docker-compose.yml
└── server2/
    ├── .env
    ├── docker-compose.yml
```

Update `LISTEN_PORT` in each `.env` to use different ports (25565, 25566, etc.)

## Docker Commands

```bash
# Start proxy
docker-compose up -d

# View logs
docker-compose logs -f

# Stop proxy
docker-compose down

# Rebuild after code changes
docker-compose up -d --build
```

## How It Works

1. **Player Ping**: Shows custom MOTD players when server is sleeping
2. **Player Join**: Sends start signal to Pterodactyl, shows "waking up" message
3. **Server Starting**: Listenes for Pterodactyl to mark server as up
4. **Server Running**: Transparent TCP proxy to backend server
5. **Idle Detection**: Checks player count every 60 seconds
6. **Auto-Shutdown**: Stops server after configured idle time

## Server States

- **Sleeping (offline)**: Shows moon emoji 💤
- **Waking (starting)**: Shows hourglass, tells players to reconnect
- **Awake (running)**: Transparent proxy, normal gameplay
- **Auto-shutdown**: Stops after idle timeout, returns to sleeping

## Troubleshooting

**Server won't wake**:

- Check Pterodactyl API key is a **Client** key (starts with `ptlc_`)
- Verify `PTERO_SERVER_ID` matches your server UUID
- Check proxy logs for API errors

**Players can't connect when server is running**:

- Verify `BACKEND_HOST` and `BACKEND_PORT` are correct
- Check firewall allows connections to backend server
- Review proxy logs for connection errors

## License

MIT
