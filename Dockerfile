# 使用官方 Node.js 运行时作为父镜像
FROM node:18

# 设置工作目录
WORKDIR /app

# 将 package.json 和 package-lock.json 复制到工作目录
COPY package*.json ./

# 安装npm包
RUN npm install

# 将应用文件复制到工作目录
COPY . .

# 暴露应用程序的端口
EXPOSE 8980

# 定义启动命令
CMD [ "npm", "start" ]
