export type TokenPair = {
  access: string;
  accessExpiresAt: string;
  refresh: string;
  refreshExpiresAt: string;
};

export type Institution = {
  id: string;
  name: string;
  bic?: string;
  transaction_total_days?: string;
  countries: string[];
  logo?: string;
};

export type Requisition = {
  id: string;
  created: string;
  status: string;
  institution_id: string;
  link: string;
  accounts: string[];
  redirect: string;
  reference?: string;
};

export type GCAccount = {
  id: string;
  iban?: string;
  name?: string;
  currency: string;
  institution_id: string;
  owner_name?: string;
  product?: string;
};

export type GCTransaction = {
  transactionId?: string;
  internalTransactionId?: string;
  bookingDate?: string;
  valueDate?: string;
  bookingDateTime?: string;
  transactionAmount: { amount: string; currency: string };
  creditorName?: string;
  debtorName?: string;
  remittanceInformationUnstructured?: string;
  remittanceInformationUnstructuredArray?: string[];
  additionalInformation?: string;
  merchantCategoryCode?: string;
};

export type TransactionsResponse = {
  transactions: {
    booked: GCTransaction[];
    pending: GCTransaction[];
  };
};
