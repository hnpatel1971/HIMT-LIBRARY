import { QueryClient } from "@tanstack/react-query";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public overridable = false,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init?.method ?? (init?.body ? "POST" : "GET"),
    headers: init?.body ? { "content-type": "application/json" } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
    credentials: "same-origin",
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? res.statusText, !!data.overridable);
  return data as T;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (n, err) => !(err instanceof ApiError && err.status < 500) && n < 2,
      refetchOnWindowFocus: false,
    },
  },
});

// Shapes returned by the server.
export interface Me {
  id: number;
  username: string;
  name: string;
  role: "admin" | "librarian" | "assistant";
}
export interface Paged<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}
export interface TitleRow {
  id: number;
  title: string;
  authors: string[];
  corporateAuthor: string | null;
  publisher: string | null;
  year: string | null;
  callNumber: string | null;
  isbn: string | null;
  copies: number;
  available: number;
  ebooks: number;
}
export interface CopyInfo {
  id: number;
  barcode: string;
  status: "available" | "repair" | "no_loan" | "missing" | "withdrawn";
  location: string | null;
  collectionType: string | null;
  callNumber: string | null;
  dueOn: string | null;
  onLoan: boolean;
  locationId?: number | null;
  collectionTypeId?: number | null;
  price?: string | null;
  supplier?: string | null;
  invoice?: string | null;
  receivedOn?: string | null;
  borrower?: string | null;
  borrowerCode?: string | null;
}
export interface TitleDetail {
  id: number;
  title: string;
  authors: string[];
  corporateAuthor: string | null;
  subjects: string[];
  publisher: string | null;
  place: string | null;
  year: string | null;
  edition: string | null;
  isbn: string | null;
  callNumber: string | null;
  classification: string | null;
  language: string | null;
  formatId: number | null;
  format: string | null;
  notes: string | null;
  copies: CopyInfo[];
  files: TitleFile[];
}
/** An e-book file on a title. Staff see every field; the public catalogue only some. */
export interface TitleFile {
  id: number;
  name: string;
  size: number;
  allowDownload: boolean;
  access?: "public" | "staff";
  opens?: number;
  createdAt?: string;
}
export interface FileInfo {
  id: number;
  titleId: number;
  title: string;
  name: string;
  size: number;
  allowDownload: boolean;
}
export interface Lookup {
  id: number;
  name: string;
}
export interface MemberType {
  id: number;
  name: string;
  loanLimit: number;
  loanDays: number;
  renewLimit: number;
  finePerDay: string;
  reserveLimit: number;
  membershipDays: number;
}
export interface MemberRow {
  id: number;
  code: string;
  name: string;
  type: string;
  department: string | null;
  expiresOn: string | null;
  active: boolean;
  onLoan: number;
  balance: number;
}
export interface LoanLine {
  id: number;
  barcode: string;
  title: string;
  titleId: number;
  issuedOn: string;
  dueOn: string;
  returnedOn: string | null;
  renewCount: number;
  overdue?: boolean;
}
export interface MemberDetail {
  id: number;
  code: string;
  name: string;
  typeId: number;
  department: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  joinedOn: string | null;
  expiresOn: string | null;
  active: boolean;
  notes: string | null;
  type: MemberType;
  current: LoanLine[];
  history: LoanLine[];
  fines: { id: number; amount: string; reason: string; chargedOn: string; waived: boolean }[];
  payments: { id: number; amount: string; paidOn: string; receiptNo: string | null; note: string | null }[];
  balance: number;
}
export interface ReportLoan {
  id: number;
  barcode: string;
  title: string;
  titleId: number;
  memberId: number;
  memberCode: string;
  member: string;
  phone: string | null;
  memberType: string;
  issuedOn: string;
  dueOn: string;
  returnedOn: string | null;
  renewCount: number;
  daysOverdue?: number;
}
