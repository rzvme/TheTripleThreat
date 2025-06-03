FROM nginx:alpine
# Remove default nginx content
RUN rm -rf /usr/share/nginx/html/*
# Copy your website
COPY main.html /usr/share/nginx/html/
# Copy custom nginx config (optional but recommended)
COPY nginx.conf /etc/nginx/nginx.conf
EXPOSE 80
