export const emailChangeConfirmationTemplate = (
  name: string,
  oldEmail: string,
  newEmail: string,
  confirmLink: string,
  cancelLink: string,
): string => {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Confirm Email Change Request</title>
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
          margin: 12px 8px;
        }
        .button-danger {
          background-color: #dc3545;
        }
        .email-box {
          background: #f5f5f5;
          padding: 16px;
          border-radius: 4px;
          margin: 16px 0;
          text-align: center;
        }
        .email-box strong {
          color: #000000;
          font-size: 16px;
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
          <h1 class="logo">NotifyHub</h1>
        </div>
        
        <div class="content">
          <h2 class="title">Confirm Email Change Request</h2>
          
          <p class="text">Hi ${name},</p>
          
          <p class="text">
            Someone requested to change your NotifyHub email address from:
          </p>
          
          <div class="email-box">
            <strong>${oldEmail}</strong> → <strong>${newEmail}</strong>
          </div>
          
          <div class="warning">
            <strong> Important:</strong> Both your old and new email addresses must be 
            confirmed for this change to complete.
          </div>
          
          <p class="text">If this was you, click the button below to confirm:</p>
          
          <div style="text-align: center;">
            <a href="${confirmLink}" class="button">Confirm Email Change</a>
          </div>
          
          <p class="text">If this wasn't you, click here to cancel immediately:</p>
          
          <div style="text-align: center;">
            <a href="${cancelLink}" class="button button-danger">Cancel This Request</a>
          </div>
          
          <p class="text" style="font-size: 14px; color: #999999;">
            This link expires in 30 minutes.
          </p>
        </div>
        
        <div class="footer">
          <p>© ${new Date().getFullYear()} NotifyHub. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;
};
