# Build Stage
FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN ls /app/package.json

RUN npm install

COPY . .

# Build args to allow passing environment variables at build time
ARG REACT_APP_API_URL
ENV REACT_APP_API_URL=$REACT_APP_API_URL

RUN npm run build

# Production Stage
FROM nginx:alpine

# Copy custom nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

COPY --from=build /app/build /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
