export const emailChangeVerificationTemplate = (
  name: string,
  verifyLink: string,
): string => {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Verify Your New Email Address</title>
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
        .link-text {
          font-size: 14px;
          color: #999999;
          word-break: break-all;
          background: #f5f5f5;
          padding: 12px;
          border-radius: 4px;
          margin: 16px 0;
        }
        .warning {
          background-color: #fff3cd;
          border-left: 4px solid #ffc107;
          padding: 16px;
          margin: 24px 0;
          border-radius: 4px;
        }
        .footer {
          background-color: #f5f5f5;
          padding: 24px;
          text-align: center;
          font-size: 14px;
          color: #999999;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1 class="logo">NotifyKit</h1>
        </div>
        
        <div class="content">
          <h2 class="title">Verify Your New Email Address</h2>
          
          <p class="text">Hi ${name},</p>
          
          <p class="text">
            You requested to change your NotifyKit email address. Click the button below 
            to verify you own this email:
          </p>
          
          <div style="text-align: center;">
            <a href="${verifyLink}" class="button">Verify Email Address</a>
          </div>
          
          <p class="text">Or copy and paste this link into your browser:</p>
          <div class="link-text">${verifyLink}</div>
          
          <div class="warning">
            <strong>⏱ This link expires in 30 minutes.</strong>
          </div>
          
          <p class="text">
            If you didn't request this change, you can safely ignore this email.
          </p>
        </div>
        
        <div class="footer">
          <p>© ${new Date().getFullYear()} NotifyKit. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;
};
