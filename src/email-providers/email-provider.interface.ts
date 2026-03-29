export interface SendEmailParams {
  to: string;
  subject: string;
  body: string;
  from?: string;
  jobId?: string;
}

export interface IEmailProvider {
  sendEmail(params: SendEmailParams, apiKey: string): Promise<any>;
}
