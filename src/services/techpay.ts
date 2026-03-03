const TECHPAY_BASE_URL = process.env.TECHPAY_BASE_URL || 'https://new.techpay.co.zm/api/v1';
const TECHPAY_API_KEY = process.env.TECHPAY_API_KEY || '';
const TECHPAY_API_ID = process.env.TECHPAY_API_ID || '';

export interface PaymentInitiation {
  amount: number;
  phoneNumber: string;
  reference: string;
  description: string;
  callbackUrl: string;
}

export interface TechPayResponse {
  success: boolean;
  token?: string;
  message?: string;
  data?: any;
}

export async function initiatePayment(payment: PaymentInitiation): Promise<TechPayResponse> {
  try {
    const response = await fetch(`${TECHPAY_BASE_URL}/payment/initiate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TECHPAY_API_KEY}`,
        'x-api-id': TECHPAY_API_ID,
      },
      body: JSON.stringify({
        amount: payment.amount,
        phone: payment.phoneNumber,
        reference: payment.reference,
        description: payment.description,
        callback_url: payment.callbackUrl,
      }),
    });

    const data: any = await response.json();
    return {
      success: data.success || response.ok,
      token: data.token || data.data?.token,
      message: data.message,
      data,
    };
  } catch (error) {
    console.error('TechPay initiation error:', error);
    return { success: false, message: 'Payment initiation failed' };
  }
}

export async function checkPaymentStatus(token: string): Promise<TechPayResponse> {
  try {
    const response = await fetch(`${TECHPAY_BASE_URL}/payment/status/${token}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${TECHPAY_API_KEY}`,
        'x-api-id': TECHPAY_API_ID,
      },
    });

    const data: any = await response.json();
    return {
      success: data.success || response.ok,
      data,
      message: data.message,
    };
  } catch (error) {
    console.error('TechPay status check error:', error);
    return { success: false, message: 'Status check failed' };
  }
}
