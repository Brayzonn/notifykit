export interface StripeWebhookEvent {
  id: string;
  type: string;
  data: {
    object: any;
  };
}

export interface PaddleWebhookEvent {
  alert_name: string;
  alert_id: string;
  [key: string]: any;
}
