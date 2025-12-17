module.exports = {
  apps: [
    {
      name: 'appname',
      script: './dist/src/main.js',
      cwd: '/home/user/app-name',
      instances: 1,
      exec_mode: 'fork',
      env_production: {
        NODE_ENV: 'production',
        PORT: 9002,
      },
      env_file: '.env',
      error_file: './logs/pm2-err.log',
      out_file: './logs/pm2-out.log',
      time: true,
    },
  ],
};
