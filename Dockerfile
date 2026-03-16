FROM mcr.microsoft.com/playwright:v1.50.0-noble

WORKDIR /app

# Copy package files first for better Docker layer caching
COPY package*.json ./

# Install production dependencies only
RUN npm ci --production

# Copy application files
COPY . .

# Create data directories and set ownership for non-root user
RUN mkdir -p data/reports data/screenshots && chown -R pwuser:pwuser data

# Run as non-root user (pwuser is provided by Playwright image)
USER pwuser

EXPOSE 3200

CMD ["node", "server.js"]
