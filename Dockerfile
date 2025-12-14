FROM node:18-bullseye

# Install yt-dlp
RUN apt-get update && \
    apt-get install -y yt-dlp && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 10000

CMD ["npm", "start"]
