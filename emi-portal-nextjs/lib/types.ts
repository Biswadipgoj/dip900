export type Role = 'super_admin' | 'retailer';

export interface Profile {
  user_id: string;
  role: Role;
  created_at: string;
}

export interface Retailer {
  id: string;
  auth_user_id: string;
  name: string;
  username: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Customer {
  id: string;
  retailer_id: string;
  retailer?: Retailer | null;
  customer_name: string;
  father_name?: string;
  aadhaar?: string;
  voter_id?: string;
  address?: string;
  landmark?: string;
  mobile: string;
  alternate_number_1?: string;
  alternate_number_2?: string;
  model_no?: string;
  imei: string;
  purchase_value: number;
  down_payment: number;
  disburse_amount?: number;
  purchase_date: string;
  emi_due_day: number;
  emi_amount: number;
  emi_tenure: number;
  first_emi_charge_amount: number;
  first_emi_charge_paid_at?: string;
  box_no?: string;
  // Image URLs (IBB hosted)
  customer_photo_url?: string;
  aadhaar_front_url?: string;
  aadhaar_back_url?: string;
  bill_photo_url?: string;
  status: 'RUNNING' | 'COMPLETE';
  completion_remark?: string;
  completion_date?: string;
  created_at: string;
  updated_at: string;
}

export interface EMISchedule {
  id: string;
  customer_id: string;
  emi_no: number;
  due_date: string;
  amount: number;
  status: 'UNPAID' | 'PENDING_APPROVAL' | 'APPROVED';
  paid_at?: string;
  mode?: 'CASH' | 'UPI';
  approved_by?: string;
  fine_amount: number;
  fine_waived: boolean;
  collected_by_role?: 'admin' | 'retailer';
  collected_by_user_id?: string;
  created_at: string;
  updated_at: string;
}

export interface PaymentRequest {
  id: string;
  customer_id: string;
  customer?: Partial<Customer>;
  retailer_id: string;
  retailer?: Partial<Retailer>;
  submitted_by?: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  mode: 'CASH' | 'UPI';
  total_emi_amount: number;
  fine_amount: number;
  first_emi_charge_amount: number;
  total_amount: number;
  notes?: string;
  rejection_reason?: string;
  approved_by?: string;
  approved_at?: string;
  selected_emi_nos?: number[];
  items?: PaymentRequestItem[];
  created_at: string;
  updated_at: string;
}

export interface PaymentRequestItem {
  id: string;
  payment_request_id: string;
  emi_schedule_id: string;   // matches DB column name
  emi_no: number;
  amount: number;
}

export interface DueBreakdown {
  customer_id: string;
  customer_status: string;
  next_emi_no?: number;
  next_emi_amount?: number;
  next_emi_due_date?: string;
  next_emi_status?: string;
  selected_emi_no?: number;
  selected_emi_amount?: number;
  fine_due: number;
  first_emi_charge_due: number;
  total_payable: number;
  popup_first_emi_charge: boolean;
  popup_fine_due: boolean;
  is_overdue: boolean;
}

export interface AuditLog {
  id: string;
  user_id: string;
  action: string;
  table_name: string;
  record_id: string;
  before_data?: Record<string, unknown>;
  after_data?: Record<string, unknown>;
  remark?: string;
  created_at: string;
}

export interface FineSettings {
  id: number;
  default_fine_amount: number;
  updated_at: string;
}
