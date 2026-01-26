# Dockerfile

# 1. Base image
FROM node:20-alpine

# 2. Workdir
WORKDIR /app

# 3. Install dependencies
COPY package*.json ./
RUN npm ci --omit=dev || npm install --only=production

# 4. Copy the rest of the code
COPY . .

# 5. Production env
ENV NODE_ENV=production

# 6. Your app ALREADY listens on port 3001
EXPOSE 3001

# 7. Start exactly like you do on Render
# (Fly logs show: npm run start -> node safaricom.js)
CMD ["npm", "run", "start"]
