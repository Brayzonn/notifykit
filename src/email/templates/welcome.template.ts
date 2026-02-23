export const welcomeEmailTemplate = (name: string): string => {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Welcome to NotifyKit</title>
      <style>
        body {
          margin: 0;
          padding: 0;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
          background-color: #f5f5f5;
        }
        .container {
          max-width: 600px;
          margin: 40px auto;
          background-color: #ffffff;
          border-radius: 8px;
          overflow: hidden;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }
        .header {
          background-color: #000000;
          padding: 32px 24px;
          text-align: center;
        }
        .logo {
          color: #ffffff;
          font-size: 24px;
          font-weight: bold;
          margin: 0;
        }
        .content {
          padding: 40px 24px;
        }
        .title {
          font-size: 24px;
          font-weight: bold;
          color: #000000;
          margin: 0 0 16px 0;
        }
        .text {
          font-size: 16px;
          color: #666666;
          line-height: 1.6;
          margin: 0 0 24px 0;
        }
        .button {
          display: inline-block;
          background-color: #000000;
          color: #ffffff;
          padding: 14px 32px;
          text-decoration: none;
          border-radius: 8px;
          font-weight: 600;
          margin: 24px 0;
        }
        .features {
          border: 1px solid #e5e5e5;
          border-radius: 8px;
          padding: 0;
          margin: 32px 0;
          overflow: hidden;
        }
        .feature-item {
          padding: 20px 24px;
          border-bottom: 1px solid #e5e5e5;
        }
        .feature-item:last-child {
          border-bottom: none;
        }
        .feature-title {
          font-weight: 600;
          font-size: 16px;
          color: #000000;
          margin: 0 0 6px 0;
        }
        .feature-text {
          font-size: 14px;
          color: #666666;
          line-height: 1.5;
          margin: 0;
        }
        .footer {
          background-color: #f5f5f5;
          padding: 24px;
          text-align: center;
          font-size: 14px;
          color: #999999;
        }
        .footer a {
          color: #000000;
          text-decoration: none;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1 class="logo">NotifyKit</h1>
        </div>
        
        <div class="content">
          <h2 class="title">Welcome to NotifyKit, ${name}</h2>
          
          <p class="text">
            Your account has been successfully created. You're now ready to send 
            notifications with our simple and reliable infrastructure.
          </p>
          
          <div style="text-align: center;">
            <a href="https://notifykit.dev/dashboard" class="button">
              Get Started
            </a>
          </div>
          
          <div class="features">
            <div class="feature-item">
              <p class="feature-title">Email Delivery</p>
              <p class="feature-text">
                Send emails through our API with automatic retries and monitoring
              </p>
            </div>
            
            <div class="feature-item">
              <p class="feature-title">Webhooks</p>
              <p class="feature-text">
                Trigger webhooks for events with built-in queue management
              </p>
            </div>
            
            <div class="feature-item">
              <p class="feature-title">Analytics</p>
              <p class="feature-text">
                Track delivery status and monitor your notification infrastructure
              </p>
            </div>
          </div>
          
          <p class="text">
            Need help getting started? Check out our 
            <a href="https://docs.notifykit.dev" style="color: #000000; text-decoration: none; font-weight: 600;">documentation</a> 
            or reach out to our support team.
          </p>
        </div>
        
        <div class="footer">
          <p>© ${new Date().getFullYear()} NotifyKit. All rights reserved.</p>
          <p>
            <a href="https://notifykit.dev">Website</a> | 
            <a href="https://docs.notifykit.dev">Documentation</a>
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
};
