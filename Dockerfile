FROM node:24-alpine

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY server.js ./

# Create directory for server icon
RUN mkdir -p /app/data

# Expose the default Minecraft port
EXPOSE 25565

# Run the application
CMD ["node", "server.js"]
