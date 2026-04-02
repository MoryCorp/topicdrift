FROM nginx:alpine

RUN apk add --no-cache nodejs npm

WORKDIR /build
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

RUN cp -r /build/dist/* /usr/share/nginx/html/ && \
    cp /build/nginx.conf /etc/nginx/conf.d/default.conf && \
    rm -rf /build

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
