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
        NODE_ENV: "production",
        TICKET_HANDLER_ROLE_ID: "1506184638207361145",
        TICKET_DEFAULT_CATEGORY_ID: "1523411322430296228",
        PERMANENT_TICKET_PANEL_CHANNEL_ID: "1506119505720377434",
        BOT_FEATURE_BRIEF_CHANNEL_ID: "1528998695624773714",
        WELCOME_PANEL_CHANNEL_ID: "1527571592320651285",
        MOD_LOG_CHANNEL_ID: "1529643338041659573",
        DEPLOYMENT_SUMMARY_CHANNEL_ID: "1534712078089060583"
      }
    }
  ]
};
