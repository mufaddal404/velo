# Use a Node.js base image that meets the requirement of velo-http (node >= 20.6.0)
FROM node:lts-alpine

# Set the working directory inside the container
WORKDIR /app

# Copy package files first to leverage Docker cache for dependencies
COPY package.json package-lock.json ./

# Install only production dependencies
RUN npm ci --omit=dev

# Copy the server source code and the public directory
COPY index.js ./
COPY public/ ./public/

# The server listens on port 3000 by default (as seen in index.js)
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Start the server
CMD ["node", "index.js"]
