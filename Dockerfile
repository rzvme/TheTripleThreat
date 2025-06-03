FROM nginx:alpine
# Remove default nginx content
RUN rm -rf /usr/share/nginx/html/*
# Copy your website files
COPY main.html /usr/share/nginx/html/
# Copy any other static assets if you have them
# COPY assets/ /usr/share/nginx/html/assets/
EXPOSE 80
