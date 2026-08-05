module.exports = {
  apps: [
    {
      name: "titan-raid-bot",
      cwd: __dirname,
      script: "npm",
      args: "run start",
      interpreter: "none",
      autorestart: true,
      watch: false,
      max_restarts: 10,
      min_uptime: "20s",
      restart_delay: 5000,
      exp_backoff_restart_delay: 250,
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
