/* People data for the HO view. Invented, but shaped like a retail group:
 * one head office, six stores and a distribution centre, each with a plan
 * headcount that the actual roster sits either side of.
 */

export type LocationKind = "ho" | "store" | "warehouse"
export type EmploymentType = "permanent" | "contract" | "part-time" | "intern"
export type EmployeeStatus = "active" | "probation" | "notice"

export interface Location {
  id: string
  name: string
  kind: LocationKind
  region: string
  /** Budgeted headcount for the period. */
  plan: number
}

export interface Employee {
  id: string
  name: string
  role: string
  division: string
  locationId: string
  employmentType: EmploymentType
  status: EmployeeStatus
  tenureMonths: number
  hue: string
  /** Overtime booked this month. */
  overtimeHours: number
  /** Attendance rate this month, as a percentage. */
  attendance: number
  managerId: string | null
  /** Set for fixed-term staff; permanent contracts have no end. */
  contractEndsOn?: string
}

export interface Leaver {
  locationId: string
  /** Months since they left. */
  months: number
}

export const LOCATIONS: Location[] = [
  { id: "ho", name: "Head Office", kind: "ho", region: "Jakarta", plan: 34 },
  { id: "st-pi", name: "Pondok Indah", kind: "store", region: "Jakarta", plan: 14 },
  { id: "st-grand", name: "Grand Indonesia", kind: "store", region: "Jakarta", plan: 18 },
  { id: "st-bdg", name: "Paris van Java", kind: "store", region: "Bandung", plan: 12 },
  { id: "st-sby", name: "Tunjungan Plaza", kind: "store", region: "Surabaya", plan: 13 },
  { id: "st-dps", name: "Beachwalk", kind: "store", region: "Denpasar", plan: 10 },
  { id: "st-mdn", name: "Sun Plaza", kind: "store", region: "Medan", plan: 11 },
  { id: "wh-ckr", name: "Cikarang DC", kind: "warehouse", region: "Bekasi", plan: 22 },
]

const SEED_PEOPLE: Employee[] = [
  { id: "e001", name: "Bayu Halim", role: "Merchandiser", division: "Merchandising", locationId: "ho", employmentType: "part-time", status: "active", tenureMonths: 18, hue: "#00c978", overtimeHours: 15.0, attendance: 99, managerId: null },
  { id: "e002", name: "Nanda Firmansyah", role: "Merchandiser", division: "Merchandising", locationId: "ho", employmentType: "permanent", status: "notice", tenureMonths: 80, hue: "#64c6ff", overtimeHours: 0.0, attendance: 94, managerId: "e001" },
  { id: "e003", name: "Zahra Halim", role: "Area Manager", division: "Retail Ops", locationId: "ho", employmentType: "permanent", status: "active", tenureMonths: 53, hue: "#ff3e00", overtimeHours: 15.0, attendance: 89, managerId: "e001" },
  { id: "e004", name: "Mila Setiawan", role: "Senior Merchandiser", division: "Merchandising", locationId: "ho", employmentType: "part-time", status: "active", tenureMonths: 28, hue: "#00c978", overtimeHours: 4.0, attendance: 94, managerId: "e001" },
  { id: "e005", name: "Gita Wijaya", role: "People Manager", division: "People", locationId: "ho", employmentType: "permanent", status: "active", tenureMonths: 86, hue: "#64c6ff", overtimeHours: 7.5, attendance: 89, managerId: "e001" },
  { id: "e006", name: "Joko Suryani", role: "Logistics Officer", division: "Supply Chain", locationId: "ho", employmentType: "contract", status: "active", tenureMonths: 36, hue: "#64c6ff", overtimeHours: 3.0, attendance: 88, managerId: "e001" },
  { id: "e007", name: "Dimas Rahman", role: "People Manager", division: "People", locationId: "ho", employmentType: "permanent", status: "active", tenureMonths: 91, hue: "#ff3e00", overtimeHours: 4.0, attendance: 88, managerId: "e001" },
  { id: "e008", name: "Citra Kusuma", role: "AP Officer", division: "Finance", locationId: "ho", employmentType: "permanent", status: "notice", tenureMonths: 27, hue: "#64c6ff", overtimeHours: 2.5, attendance: 93, managerId: "e001" },
  { id: "e009", name: "Putri Pratama", role: "Visual Merchandiser", division: "Retail Ops", locationId: "ho", employmentType: "intern", status: "notice", tenureMonths: 32, hue: "#0086fc", overtimeHours: 9.0, attendance: 89, managerId: "e001" },
  { id: "e010", name: "Indra Firmansyah", role: "Sourcing Analyst", division: "Sourcing", locationId: "ho", employmentType: "contract", status: "active", tenureMonths: 36, hue: "#7b5cfa", overtimeHours: 2.5, attendance: 95, managerId: "e001" },
  { id: "e011", name: "Fajar Handoko", role: "Senior Merchandiser", division: "Merchandising", locationId: "ho", employmentType: "permanent", status: "active", tenureMonths: 47, hue: "#7b5cfa", overtimeHours: 0.5, attendance: 91, managerId: "e001" },
  { id: "e012", name: "Mila Wijaya", role: "Sourcing Manager", division: "Sourcing", locationId: "ho", employmentType: "permanent", status: "active", tenureMonths: 25, hue: "#ff58ae", overtimeHours: 15.0, attendance: 90, managerId: "e001" },
  { id: "e013", name: "Joko Permata", role: "Picker", division: "Supply Chain", locationId: "ho", employmentType: "permanent", status: "active", tenureMonths: 53, hue: "#00b8a9", overtimeHours: 7.0, attendance: 98, managerId: "e001" },
  { id: "e014", name: "Ayu Setiawan", role: "HR Generalist", division: "People", locationId: "ho", employmentType: "permanent", status: "active", tenureMonths: 50, hue: "#ff58ae", overtimeHours: 6.5, attendance: 90, managerId: "e001" },
  { id: "e015", name: "Adit Halim", role: "Accountant", division: "Finance", locationId: "ho", employmentType: "permanent", status: "active", tenureMonths: 54, hue: "#ff3e00", overtimeHours: 11.5, attendance: 97, managerId: "e001" },
  { id: "e016", name: "Bayu Kusuma", role: "Accountant", division: "Finance", locationId: "ho", employmentType: "permanent", status: "active", tenureMonths: 93, hue: "#00b8a9", overtimeHours: 12.5, attendance: 96, managerId: "e001" },
  { id: "e017", name: "Sinta Firmansyah", role: "Merchandiser", division: "Merchandising", locationId: "ho", employmentType: "contract", status: "active", tenureMonths: 88, hue: "#ff3e00", overtimeHours: 6.5, attendance: 89, managerId: "e001" },
  { id: "e018", name: "Kirana Firmansyah", role: "Retail Ops Analyst", division: "Retail Ops", locationId: "ho", employmentType: "permanent", status: "active", tenureMonths: 54, hue: "#0086fc", overtimeHours: 3.5, attendance: 93, managerId: "e001" },
  { id: "e019", name: "Nanda Wibowo", role: "Retail Ops Analyst", division: "Retail Ops", locationId: "ho", employmentType: "contract", status: "active", tenureMonths: 41, hue: "#ff58ae", overtimeHours: 3.0, attendance: 98, managerId: "e001" },
  { id: "e020", name: "Dewi Anggraini", role: "Sourcing Specialist", division: "Sourcing", locationId: "ho", employmentType: "part-time", status: "probation", tenureMonths: 3, hue: "#7b5cfa", overtimeHours: 4.0, attendance: 98, managerId: "e001" },
  { id: "e021", name: "Intan Santoso", role: "Finance Analyst", division: "Finance", locationId: "ho", employmentType: "part-time", status: "active", tenureMonths: 31, hue: "#ffbb26", overtimeHours: 16.5, attendance: 92, managerId: "e001" },
  { id: "e022", name: "Joko Santoso", role: "Visual Merchandiser", division: "Retail Ops", locationId: "ho", employmentType: "permanent", status: "probation", tenureMonths: 1, hue: "#ffbb26", overtimeHours: 1.0, attendance: 98, managerId: "e001" },
  { id: "e023", name: "Vina Halim", role: "QA Officer", division: "Sourcing", locationId: "ho", employmentType: "permanent", status: "active", tenureMonths: 28, hue: "#0086fc", overtimeHours: 7.0, attendance: 93, managerId: "e001" },
  { id: "e024", name: "Hana Wibowo", role: "Picker", division: "Supply Chain", locationId: "ho", employmentType: "permanent", status: "active", tenureMonths: 43, hue: "#0086fc", overtimeHours: 1.5, attendance: 93, managerId: "e001" },
  { id: "e025", name: "Tari Suryani", role: "QA Officer", division: "Sourcing", locationId: "ho", employmentType: "permanent", status: "active", tenureMonths: 38, hue: "#ff3e00", overtimeHours: 15.0, attendance: 94, managerId: "e001" },
  { id: "e026", name: "Krisna Halim", role: "AP Officer", division: "Finance", locationId: "ho", employmentType: "permanent", status: "active", tenureMonths: 51, hue: "#ff58ae", overtimeHours: 4.0, attendance: 94, managerId: "e001" },
  { id: "e027", name: "Umar Setiawan", role: "HR Generalist", division: "People", locationId: "ho", employmentType: "permanent", status: "active", tenureMonths: 12, hue: "#64c6ff", overtimeHours: 4.5, attendance: 93, managerId: "e001" },
  { id: "e028", name: "Dimas Kusuma", role: "Area Manager", division: "Retail Ops", locationId: "ho", employmentType: "permanent", status: "notice", tenureMonths: 68, hue: "#0086fc", overtimeHours: 0.0, attendance: 95, managerId: "e001" },
  { id: "e029", name: "Umar Firmansyah", role: "Senior Merchandiser", division: "Merchandising", locationId: "ho", employmentType: "intern", status: "probation", tenureMonths: 21, hue: "#ff3e00", overtimeHours: 6.0, attendance: 98, managerId: "e001" },
  { id: "e030", name: "Intan Handoko", role: "Buying Manager", division: "Merchandising", locationId: "ho", employmentType: "intern", status: "notice", tenureMonths: 36, hue: "#ff58ae", overtimeHours: 16.0, attendance: 90, managerId: "e001" },
  { id: "e031", name: "Ratna Purnomo", role: "Logistics Officer", division: "Supply Chain", locationId: "ho", employmentType: "permanent", status: "active", tenureMonths: 12, hue: "#ff3e00", overtimeHours: 15.5, attendance: 92, managerId: "e001" },
  { id: "e032", name: "Hana Firmansyah", role: "Assistant Merchandiser", division: "Merchandising", locationId: "ho", employmentType: "contract", status: "probation", tenureMonths: 68, hue: "#7b5cfa", overtimeHours: 11.5, attendance: 94, managerId: "e001" },
  { id: "e033", name: "Mila Halim", role: "Recruiter", division: "People", locationId: "ho", employmentType: "contract", status: "active", tenureMonths: 72, hue: "#0086fc", overtimeHours: 6.0, attendance: 98, managerId: "e001" },
  { id: "e034", name: "Lestari Halim", role: "Retail Ops Analyst", division: "Retail Ops", locationId: "ho", employmentType: "permanent", status: "active", tenureMonths: 59, hue: "#7b5cfa", overtimeHours: 7.5, attendance: 95, managerId: "e001" },
  { id: "e035", name: "Adit Sitorus", role: "Sourcing Manager", division: "Sourcing", locationId: "ho", employmentType: "permanent", status: "notice", tenureMonths: 41, hue: "#7b5cfa", overtimeHours: 15.0, attendance: 90, managerId: "e001" },
  { id: "e036", name: "Oka Sitorus", role: "Store Manager", division: "Store Ops", locationId: "st-pi", employmentType: "permanent", status: "active", tenureMonths: 56, hue: "#00c978", overtimeHours: 0.5, attendance: 90, managerId: "e001" },
  { id: "e037", name: "Sari Halim", role: "Assistant Store Manager", division: "Store Ops", locationId: "st-pi", employmentType: "permanent", status: "notice", tenureMonths: 91, hue: "#64c6ff", overtimeHours: 3.0, attendance: 97, managerId: "e036" },
  { id: "e038", name: "Toni Halim", role: "Stock Associate", division: "Store Ops", locationId: "st-pi", employmentType: "permanent", status: "active", tenureMonths: 12, hue: "#7b5cfa", overtimeHours: 13.0, attendance: 89, managerId: "e036" },
  { id: "e039", name: "Tari Nugroho", role: "Stock Associate", division: "Store Ops", locationId: "st-pi", employmentType: "permanent", status: "active", tenureMonths: 68, hue: "#7b5cfa", overtimeHours: 1.0, attendance: 89, managerId: "e036" },
  { id: "e040", name: "Sinta Santoso", role: "Assistant Store Manager", division: "Store Ops", locationId: "st-pi", employmentType: "contract", status: "active", tenureMonths: 85, hue: "#64c6ff", overtimeHours: 13.0, attendance: 90, managerId: "e036" },
  { id: "e041", name: "Hana Purnomo", role: "Sales Associate", division: "Store Ops", locationId: "st-pi", employmentType: "part-time", status: "active", tenureMonths: 70, hue: "#ff3e00", overtimeHours: 2.0, attendance: 89, managerId: "e036" },
  { id: "e042", name: "Gita Handoko", role: "Store Manager", division: "Store Ops", locationId: "st-pi", employmentType: "permanent", status: "active", tenureMonths: 39, hue: "#ff3e00", overtimeHours: 14.5, attendance: 99, managerId: "e036" },
  { id: "e043", name: "Ferry Sitorus", role: "Stock Associate", division: "Store Ops", locationId: "st-pi", employmentType: "permanent", status: "active", tenureMonths: 93, hue: "#ffbb26", overtimeHours: 9.0, attendance: 95, managerId: "e036" },
  { id: "e044", name: "Indra Nugroho", role: "Store Manager", division: "Store Ops", locationId: "st-pi", employmentType: "contract", status: "notice", tenureMonths: 46, hue: "#64c6ff", overtimeHours: 14.5, attendance: 91, managerId: "e036" },
  { id: "e045", name: "Maya Sitorus", role: "Cashier", division: "Store Ops", locationId: "st-pi", employmentType: "contract", status: "active", tenureMonths: 77, hue: "#ff58ae", overtimeHours: 12.5, attendance: 96, managerId: "e036" },
  { id: "e046", name: "Bagus Handoko", role: "Stock Associate", division: "Store Ops", locationId: "st-pi", employmentType: "permanent", status: "active", tenureMonths: 33, hue: "#7b5cfa", overtimeHours: 1.5, attendance: 91, managerId: "e036" },
  { id: "e047", name: "Sinta Pratama", role: "Store Manager", division: "Store Ops", locationId: "st-pi", employmentType: "permanent", status: "active", tenureMonths: 73, hue: "#ff58ae", overtimeHours: 7.0, attendance: 90, managerId: "e036" },
  { id: "e048", name: "Fajar Kusuma", role: "Stock Associate", division: "Store Ops", locationId: "st-pi", employmentType: "permanent", status: "active", tenureMonths: 41, hue: "#ffbb26", overtimeHours: 0.0, attendance: 93, managerId: "e036" },
  { id: "e049", name: "Sari Handoko", role: "Stock Associate", division: "Store Ops", locationId: "st-pi", employmentType: "intern", status: "probation", tenureMonths: 1, hue: "#0086fc", overtimeHours: 11.0, attendance: 92, managerId: "e036" },
  { id: "e050", name: "Bagus Santoso", role: "Stock Associate", division: "Store Ops", locationId: "st-pi", employmentType: "permanent", status: "active", tenureMonths: 23, hue: "#00b8a9", overtimeHours: 12.5, attendance: 91, managerId: "e036" },
  { id: "e051", name: "Bayu Anggraini", role: "Store Manager", division: "Store Ops", locationId: "st-grand", employmentType: "permanent", status: "active", tenureMonths: 45, hue: "#ffbb26", overtimeHours: 9.0, attendance: 96, managerId: "e001" },
  { id: "e052", name: "Tari Wibowo", role: "Stock Associate", division: "Store Ops", locationId: "st-grand", employmentType: "contract", status: "probation", tenureMonths: 4, hue: "#ff58ae", overtimeHours: 6.0, attendance: 97, managerId: "e051" },
  { id: "e053", name: "Naufal Santoso", role: "Sales Associate", division: "Store Ops", locationId: "st-grand", employmentType: "part-time", status: "active", tenureMonths: 53, hue: "#00b8a9", overtimeHours: 15.0, attendance: 92, managerId: "e051" },
  { id: "e054", name: "Krisna Sitorus", role: "Assistant Store Manager", division: "Store Ops", locationId: "st-grand", employmentType: "contract", status: "active", tenureMonths: 42, hue: "#64c6ff", overtimeHours: 6.0, attendance: 94, managerId: "e051" },
  { id: "e055", name: "Umar Rahman", role: "Assistant Store Manager", division: "Store Ops", locationId: "st-grand", employmentType: "contract", status: "active", tenureMonths: 55, hue: "#64c6ff", overtimeHours: 16.5, attendance: 96, managerId: "e051" },
  { id: "e056", name: "Maya Wijaya", role: "Store Manager", division: "Store Ops", locationId: "st-grand", employmentType: "permanent", status: "probation", tenureMonths: 43, hue: "#ff3e00", overtimeHours: 11.5, attendance: 90, managerId: "e051" },
  { id: "e057", name: "Krisna Kusuma", role: "Cashier", division: "Store Ops", locationId: "st-grand", employmentType: "part-time", status: "active", tenureMonths: 91, hue: "#64c6ff", overtimeHours: 5.0, attendance: 91, managerId: "e051" },
  { id: "e058", name: "Laras Santoso", role: "Store Manager", division: "Store Ops", locationId: "st-grand", employmentType: "permanent", status: "active", tenureMonths: 17, hue: "#ff3e00", overtimeHours: 14.0, attendance: 90, managerId: "e051" },
  { id: "e059", name: "Citra Firmansyah", role: "Assistant Store Manager", division: "Store Ops", locationId: "st-grand", employmentType: "intern", status: "active", tenureMonths: 61, hue: "#ff3e00", overtimeHours: 10.0, attendance: 95, managerId: "e051" },
  { id: "e060", name: "Bayu Yulianti", role: "Assistant Store Manager", division: "Store Ops", locationId: "st-grand", employmentType: "permanent", status: "active", tenureMonths: 22, hue: "#ff58ae", overtimeHours: 14.0, attendance: 97, managerId: "e051" },
  { id: "e061", name: "Umar Yulianti", role: "Store Manager", division: "Store Ops", locationId: "st-grand", employmentType: "permanent", status: "active", tenureMonths: 83, hue: "#ffbb26", overtimeHours: 4.5, attendance: 96, managerId: "e051" },
  { id: "e062", name: "Naufal Permata", role: "Cashier", division: "Store Ops", locationId: "st-grand", employmentType: "permanent", status: "active", tenureMonths: 96, hue: "#64c6ff", overtimeHours: 1.0, attendance: 92, managerId: "e051" },
  { id: "e063", name: "Kirana Santoso", role: "Sales Associate", division: "Store Ops", locationId: "st-grand", employmentType: "part-time", status: "active", tenureMonths: 31, hue: "#ff3e00", overtimeHours: 3.5, attendance: 88, managerId: "e051" },
  { id: "e064", name: "Laras Mahendra", role: "Sales Associate", division: "Store Ops", locationId: "st-grand", employmentType: "contract", status: "active", tenureMonths: 51, hue: "#0086fc", overtimeHours: 8.0, attendance: 88, managerId: "e051" },
  { id: "e065", name: "Dewi Pratama", role: "Sales Associate", division: "Store Ops", locationId: "st-grand", employmentType: "contract", status: "probation", tenureMonths: 3, hue: "#ff58ae", overtimeHours: 3.0, attendance: 93, managerId: "e051" },
  { id: "e066", name: "Gita Rahman", role: "Cashier", division: "Store Ops", locationId: "st-grand", employmentType: "permanent", status: "active", tenureMonths: 75, hue: "#0086fc", overtimeHours: 13.5, attendance: 89, managerId: "e051" },
  { id: "e067", name: "Tari Firmansyah", role: "Store Manager", division: "Store Ops", locationId: "st-bdg", employmentType: "permanent", status: "active", tenureMonths: 79, hue: "#64c6ff", overtimeHours: 11.5, attendance: 90, managerId: "e001" },
  { id: "e068", name: "Eka Anggraini", role: "Cashier", division: "Store Ops", locationId: "st-bdg", employmentType: "permanent", status: "active", tenureMonths: 45, hue: "#00b8a9", overtimeHours: 9.5, attendance: 88, managerId: "e067" },
  { id: "e069", name: "Joko Pratama", role: "Stock Associate", division: "Store Ops", locationId: "st-bdg", employmentType: "permanent", status: "active", tenureMonths: 72, hue: "#00c978", overtimeHours: 2.0, attendance: 97, managerId: "e067" },
  { id: "e070", name: "Mila Sitorus", role: "Store Manager", division: "Store Ops", locationId: "st-bdg", employmentType: "contract", status: "active", tenureMonths: 70, hue: "#ff3e00", overtimeHours: 1.5, attendance: 92, managerId: "e067" },
  { id: "e071", name: "Adit Anggraini", role: "Stock Associate", division: "Store Ops", locationId: "st-bdg", employmentType: "part-time", status: "notice", tenureMonths: 91, hue: "#64c6ff", overtimeHours: 10.0, attendance: 94, managerId: "e067" },
  { id: "e072", name: "Rangga Pratama", role: "Assistant Store Manager", division: "Store Ops", locationId: "st-bdg", employmentType: "permanent", status: "active", tenureMonths: 22, hue: "#00b8a9", overtimeHours: 7.5, attendance: 96, managerId: "e067" },
  { id: "e073", name: "Dimas Halim", role: "Stock Associate", division: "Store Ops", locationId: "st-bdg", employmentType: "permanent", status: "active", tenureMonths: 70, hue: "#0086fc", overtimeHours: 13.0, attendance: 99, managerId: "e067" },
  { id: "e074", name: "Mila Purnomo", role: "Store Manager", division: "Store Ops", locationId: "st-bdg", employmentType: "permanent", status: "notice", tenureMonths: 67, hue: "#00b8a9", overtimeHours: 13.5, attendance: 95, managerId: "e067" },
  { id: "e075", name: "Indra Permata", role: "Cashier", division: "Store Ops", locationId: "st-bdg", employmentType: "contract", status: "active", tenureMonths: 64, hue: "#ff3e00", overtimeHours: 3.5, attendance: 99, managerId: "e067" },
  { id: "e076", name: "Putri Purnomo", role: "Stock Associate", division: "Store Ops", locationId: "st-bdg", employmentType: "permanent", status: "active", tenureMonths: 93, hue: "#7b5cfa", overtimeHours: 5.0, attendance: 99, managerId: "e067" },
  { id: "e077", name: "Sinta Sitorus", role: "Stock Associate", division: "Store Ops", locationId: "st-bdg", employmentType: "permanent", status: "notice", tenureMonths: 24, hue: "#ff3e00", overtimeHours: 10.5, attendance: 99, managerId: "e067" },
  { id: "e078", name: "Oka Kusuma", role: "Store Manager", division: "Store Ops", locationId: "st-sby", employmentType: "intern", status: "notice", tenureMonths: 78, hue: "#7b5cfa", overtimeHours: 0.5, attendance: 91, managerId: "e001" },
  { id: "e079", name: "Bayu Purnomo", role: "Cashier", division: "Store Ops", locationId: "st-sby", employmentType: "contract", status: "probation", tenureMonths: 1, hue: "#ffbb26", overtimeHours: 4.5, attendance: 95, managerId: "e078" },
  { id: "e080", name: "Putri Setiawan", role: "Assistant Store Manager", division: "Store Ops", locationId: "st-sby", employmentType: "part-time", status: "probation", tenureMonths: 34, hue: "#ffbb26", overtimeHours: 11.0, attendance: 93, managerId: "e078" },
  { id: "e081", name: "Intan Wijaya", role: "Store Manager", division: "Store Ops", locationId: "st-sby", employmentType: "contract", status: "active", tenureMonths: 86, hue: "#0086fc", overtimeHours: 2.5, attendance: 95, managerId: "e078" },
  { id: "e082", name: "Gita Firmansyah", role: "Assistant Store Manager", division: "Store Ops", locationId: "st-sby", employmentType: "intern", status: "active", tenureMonths: 46, hue: "#00b8a9", overtimeHours: 11.0, attendance: 90, managerId: "e078" },
  { id: "e083", name: "Joko Setiawan", role: "Cashier", division: "Store Ops", locationId: "st-sby", employmentType: "contract", status: "active", tenureMonths: 52, hue: "#ffbb26", overtimeHours: 0.0, attendance: 94, managerId: "e078" },
  { id: "e084", name: "Ferry Wijaya", role: "Assistant Store Manager", division: "Store Ops", locationId: "st-sby", employmentType: "contract", status: "active", tenureMonths: 43, hue: "#0086fc", overtimeHours: 1.5, attendance: 99, managerId: "e078" },
  { id: "e085", name: "Bayu Wijaya", role: "Cashier", division: "Store Ops", locationId: "st-sby", employmentType: "part-time", status: "notice", tenureMonths: 47, hue: "#0086fc", overtimeHours: 7.5, attendance: 92, managerId: "e078" },
  { id: "e086", name: "Indra Sitorus", role: "Stock Associate", division: "Store Ops", locationId: "st-sby", employmentType: "permanent", status: "probation", tenureMonths: 1, hue: "#7b5cfa", overtimeHours: 5.5, attendance: 95, managerId: "e078" },
  { id: "e087", name: "Putri Wibowo", role: "Stock Associate", division: "Store Ops", locationId: "st-sby", employmentType: "permanent", status: "active", tenureMonths: 52, hue: "#64c6ff", overtimeHours: 10.5, attendance: 97, managerId: "e078" },
  { id: "e088", name: "Fajar Nugroho", role: "Cashier", division: "Store Ops", locationId: "st-sby", employmentType: "part-time", status: "active", tenureMonths: 92, hue: "#00b8a9", overtimeHours: 9.0, attendance: 98, managerId: "e078" },
  { id: "e089", name: "Yudha Mahendra", role: "Stock Associate", division: "Store Ops", locationId: "st-sby", employmentType: "part-time", status: "active", tenureMonths: 37, hue: "#ffbb26", overtimeHours: 5.5, attendance: 91, managerId: "e078" },
  { id: "e090", name: "Maya Firmansyah", role: "Sales Associate", division: "Store Ops", locationId: "st-sby", employmentType: "permanent", status: "active", tenureMonths: 55, hue: "#00b8a9", overtimeHours: 0.5, attendance: 94, managerId: "e078" },
  { id: "e091", name: "Ayu Santoso", role: "Store Manager", division: "Store Ops", locationId: "st-dps", employmentType: "permanent", status: "active", tenureMonths: 22, hue: "#7b5cfa", overtimeHours: 2.0, attendance: 94, managerId: "e001" },
  { id: "e092", name: "Rangga Santoso", role: "Store Manager", division: "Store Ops", locationId: "st-dps", employmentType: "permanent", status: "active", tenureMonths: 48, hue: "#ff58ae", overtimeHours: 8.5, attendance: 89, managerId: "e091" },
  { id: "e093", name: "Fajar Anggraini", role: "Store Manager", division: "Store Ops", locationId: "st-dps", employmentType: "intern", status: "active", tenureMonths: 21, hue: "#ffbb26", overtimeHours: 16.5, attendance: 88, managerId: "e091" },
  { id: "e094", name: "Oka Suryani", role: "Stock Associate", division: "Store Ops", locationId: "st-dps", employmentType: "intern", status: "probation", tenureMonths: 36, hue: "#ff3e00", overtimeHours: 12.0, attendance: 92, managerId: "e091" },
  { id: "e095", name: "Naufal Sitorus", role: "Stock Associate", division: "Store Ops", locationId: "st-dps", employmentType: "permanent", status: "active", tenureMonths: 53, hue: "#7b5cfa", overtimeHours: 3.0, attendance: 92, managerId: "e091" },
  { id: "e096", name: "Tari Purnomo", role: "Store Manager", division: "Store Ops", locationId: "st-dps", employmentType: "part-time", status: "active", tenureMonths: 64, hue: "#7b5cfa", overtimeHours: 11.0, attendance: 91, managerId: "e091" },
  { id: "e097", name: "Fajar Firmansyah", role: "Cashier", division: "Store Ops", locationId: "st-dps", employmentType: "permanent", status: "active", tenureMonths: 49, hue: "#64c6ff", overtimeHours: 10.0, attendance: 89, managerId: "e091" },
  { id: "e098", name: "Intan Sitorus", role: "Store Manager", division: "Store Ops", locationId: "st-mdn", employmentType: "permanent", status: "probation", tenureMonths: 60, hue: "#ff58ae", overtimeHours: 14.5, attendance: 88, managerId: "e001" },
  { id: "e099", name: "Laras Kusuma", role: "Stock Associate", division: "Store Ops", locationId: "st-mdn", employmentType: "contract", status: "active", tenureMonths: 10, hue: "#ff58ae", overtimeHours: 0.0, attendance: 89, managerId: "e098" },
  { id: "e100", name: "Indra Purnomo", role: "Sales Associate", division: "Store Ops", locationId: "st-mdn", employmentType: "part-time", status: "probation", tenureMonths: 32, hue: "#00c978", overtimeHours: 10.0, attendance: 95, managerId: "e098" },
  { id: "e101", name: "Tari Halim", role: "Sales Associate", division: "Store Ops", locationId: "st-mdn", employmentType: "permanent", status: "active", tenureMonths: 76, hue: "#ff3e00", overtimeHours: 6.0, attendance: 91, managerId: "e098" },
  { id: "e102", name: "Yudha Rahman", role: "Stock Associate", division: "Store Ops", locationId: "st-mdn", employmentType: "contract", status: "active", tenureMonths: 18, hue: "#00c978", overtimeHours: 4.0, attendance: 95, managerId: "e098" },
  { id: "e103", name: "Ratna Nugroho", role: "Sales Associate", division: "Store Ops", locationId: "st-mdn", employmentType: "part-time", status: "active", tenureMonths: 34, hue: "#ffbb26", overtimeHours: 13.0, attendance: 93, managerId: "e098" },
  { id: "e104", name: "Nanda Setiawan", role: "Sales Associate", division: "Store Ops", locationId: "st-mdn", employmentType: "contract", status: "active", tenureMonths: 13, hue: "#00c978", overtimeHours: 5.5, attendance: 97, managerId: "e098" },
  { id: "e105", name: "Dewi Halim", role: "Assistant Store Manager", division: "Store Ops", locationId: "st-mdn", employmentType: "permanent", status: "active", tenureMonths: 56, hue: "#64c6ff", overtimeHours: 13.5, attendance: 88, managerId: "e098" },
  { id: "e106", name: "Sinta Mahendra", role: "Assistant Store Manager", division: "Store Ops", locationId: "st-mdn", employmentType: "contract", status: "active", tenureMonths: 80, hue: "#ffbb26", overtimeHours: 1.0, attendance: 88, managerId: "e098" },
  { id: "e107", name: "Lestari Wijaya", role: "Warehouse Supervisor", division: "Supply Chain", locationId: "wh-ckr", employmentType: "permanent", status: "active", tenureMonths: 92, hue: "#00c978", overtimeHours: 8.5, attendance: 90, managerId: "e001" },
  { id: "e108", name: "Dimas Nugroho", role: "Warehouse Supervisor", division: "Supply Chain", locationId: "wh-ckr", employmentType: "permanent", status: "active", tenureMonths: 17, hue: "#64c6ff", overtimeHours: 16.0, attendance: 96, managerId: "e107" },
  { id: "e109", name: "Ratna Setiawan", role: "Warehouse Supervisor", division: "Supply Chain", locationId: "wh-ckr", employmentType: "permanent", status: "active", tenureMonths: 50, hue: "#ff58ae", overtimeHours: 15.0, attendance: 97, managerId: "e107" },
  { id: "e110", name: "Dewi Purnomo", role: "Warehouse Supervisor", division: "Supply Chain", locationId: "wh-ckr", employmentType: "intern", status: "active", tenureMonths: 62, hue: "#ff58ae", overtimeHours: 7.5, attendance: 95, managerId: "e107" },
  { id: "e111", name: "Nanda Nugroho", role: "Receiving Clerk", division: "Supply Chain", locationId: "wh-ckr", employmentType: "permanent", status: "active", tenureMonths: 11, hue: "#00c978", overtimeHours: 8.5, attendance: 99, managerId: "e107" },
  { id: "e112", name: "Mila Pratama", role: "Picker", division: "Supply Chain", locationId: "wh-ckr", employmentType: "intern", status: "probation", tenureMonths: 85, hue: "#0086fc", overtimeHours: 16.5, attendance: 99, managerId: "e107" },
  { id: "e113", name: "Vina Purnomo", role: "Inventory Planner", division: "Supply Chain", locationId: "wh-ckr", employmentType: "intern", status: "probation", tenureMonths: 3, hue: "#7b5cfa", overtimeHours: 14.5, attendance: 91, managerId: "e107" },
  { id: "e114", name: "Nanda Suryani", role: "Picker", division: "Supply Chain", locationId: "wh-ckr", employmentType: "contract", status: "notice", tenureMonths: 47, hue: "#00b8a9", overtimeHours: 13.5, attendance: 91, managerId: "e107" },
  { id: "e115", name: "Sari Suryani", role: "Warehouse Supervisor", division: "Supply Chain", locationId: "wh-ckr", employmentType: "permanent", status: "active", tenureMonths: 94, hue: "#64c6ff", overtimeHours: 7.5, attendance: 89, managerId: "e107" },
  { id: "e116", name: "Bayu Suryani", role: "Receiving Clerk", division: "Supply Chain", locationId: "wh-ckr", employmentType: "permanent", status: "active", tenureMonths: 92, hue: "#ff3e00", overtimeHours: 11.0, attendance: 88, managerId: "e107" },
  { id: "e117", name: "Dewi Yulianti", role: "Inventory Planner", division: "Supply Chain", locationId: "wh-ckr", employmentType: "permanent", status: "active", tenureMonths: 76, hue: "#7b5cfa", overtimeHours: 10.0, attendance: 93, managerId: "e107" },
  { id: "e118", name: "Intan Permata", role: "Logistics Officer", division: "Supply Chain", locationId: "wh-ckr", employmentType: "permanent", status: "active", tenureMonths: 93, hue: "#00c978", overtimeHours: 15.5, attendance: 89, managerId: "e107" },
  { id: "e119", name: "Maya Setiawan", role: "Inventory Planner", division: "Supply Chain", locationId: "wh-ckr", employmentType: "permanent", status: "probation", tenureMonths: 2, hue: "#00c978", overtimeHours: 15.0, attendance: 97, managerId: "e107" },
  { id: "e120", name: "Citra Anggraini", role: "Inventory Planner", division: "Supply Chain", locationId: "wh-ckr", employmentType: "permanent", status: "active", tenureMonths: 29, hue: "#0086fc", overtimeHours: 5.0, attendance: 95, managerId: "e107" },
  { id: "e121", name: "Bayu Firmansyah", role: "Logistics Officer", division: "Supply Chain", locationId: "wh-ckr", employmentType: "permanent", status: "active", tenureMonths: 12, hue: "#64c6ff", overtimeHours: 11.0, attendance: 88, managerId: "e107" },
  { id: "e122", name: "Eka Firmansyah", role: "Logistics Officer", division: "Supply Chain", locationId: "wh-ckr", employmentType: "part-time", status: "active", tenureMonths: 71, hue: "#0086fc", overtimeHours: 11.5, attendance: 90, managerId: "e107" },
  { id: "e123", name: "Joko Handoko", role: "Picker", division: "Supply Chain", locationId: "wh-ckr", employmentType: "permanent", status: "active", tenureMonths: 81, hue: "#ffbb26", overtimeHours: 1.5, attendance: 92, managerId: "e107" },
  { id: "e124", name: "Bagus Firmansyah", role: "Receiving Clerk", division: "Supply Chain", locationId: "wh-ckr", employmentType: "permanent", status: "active", tenureMonths: 27, hue: "#ff58ae", overtimeHours: 7.0, attendance: 98, managerId: "e107" },
  { id: "e125", name: "Mila Permata", role: "Inventory Planner", division: "Supply Chain", locationId: "wh-ckr", employmentType: "permanent", status: "active", tenureMonths: 64, hue: "#0086fc", overtimeHours: 16.5, attendance: 95, managerId: "e107" },
  { id: "e126", name: "Nanda Yulianti", role: "Inventory Planner", division: "Supply Chain", locationId: "wh-ckr", employmentType: "permanent", status: "active", tenureMonths: 89, hue: "#ffbb26", overtimeHours: 14.0, attendance: 97, managerId: "e107" },
  { id: "e127", name: "Dimas Anggraini", role: "Warehouse Supervisor", division: "Supply Chain", locationId: "wh-ckr", employmentType: "permanent", status: "active", tenureMonths: 21, hue: "#00c978", overtimeHours: 10.5, attendance: 90, managerId: "e107" },
  { id: "e128", name: "Dimas Pratama", role: "Warehouse Supervisor", division: "Supply Chain", locationId: "wh-ckr", employmentType: "permanent", status: "active", tenureMonths: 88, hue: "#ff58ae", overtimeHours: 7.5, attendance: 93, managerId: "e107" },
  { id: "e129", name: "Eka Rahman", role: "Warehouse Supervisor", division: "Supply Chain", locationId: "wh-ckr", employmentType: "intern", status: "active", tenureMonths: 39, hue: "#ff3e00", overtimeHours: 6.0, attendance: 88, managerId: "e107" },
  { id: "e130", name: "Nanda Santoso", role: "Picker", division: "Supply Chain", locationId: "wh-ckr", employmentType: "permanent", status: "active", tenureMonths: 88, hue: "#7b5cfa", overtimeHours: 10.5, attendance: 91, managerId: "e107" },
]

/* Fixed-term staff need an end date to renew against. Nothing in the seed
 * carries one, so derive it from how long they have already been here: a
 * contract runs two years, part-time and interns one. */
const CONTRACT_MONTHS: Partial<Record<EmploymentType, number>> = {
  contract: 24,
  "part-time": 12,
  intern: 12,
}

export const EMPLOYEES: Employee[] = SEED_PEOPLE.map((person) => {
  const term = CONTRACT_MONTHS[person.employmentType]
  if (!term) return person
  /* Fixed terms get renewed, so what matters is the term they are in now:
   * count whole terms since they started and end the one they are inside. */
  const termsDone = Math.floor(person.tenureMonths / term) + 1
  const end = new Date()
  end.setHours(12, 0, 0, 0)
  end.setMonth(end.getMonth() - person.tenureMonths + termsDone * term)
  /* nudge off the month boundary so renewals do not all fall on one day */
  end.setDate(end.getDate() + ((person.id.charCodeAt(2) * 7) % 25) - 12)
  return { ...person, contractEndsOn: end.toISOString().slice(0, 10) }
})

export const LEAVERS: Leaver[] = [
  { locationId: "ho", months: 3 },
  { locationId: "st-bdg", months: 3 },
  { locationId: "st-bdg", months: 2 },
  { locationId: "st-sby", months: 11 },
  { locationId: "st-sby", months: 1 },
  { locationId: "st-dps", months: 3 },
]

/* People are the one part of this local fixture that changes while the app
 * runs — a store can add someone or correct a record, once Head Office has
 * agreed. The provider keeps the shared in-memory list in sync here, so the
 * helpers below (and every screen that calls them) read the same people. */
let registry: Employee[] = EMPLOYEES

export const setEmployeeRegistry = (list: Employee[]) => {
  registry = list
}

export const allEmployees = () => registry

export const DIVISIONS = [...new Set(EMPLOYEES.map((e) => e.division))].sort()

export const locationOf = (id: string) => LOCATIONS.find((l) => l.id === id)
export const employeeOf = (id: string | null) =>
  id ? registry.find((e) => e.id === id) : undefined

export const OVERTIME_THRESHOLD = 12

/** Headcount, plan and the exceptions HO actually acts on, per location. */
export function locationStats(locationId: string) {
  const location = locationOf(locationId)
  const people = registry.filter((e) => e.locationId === locationId)
  const plan = location?.plan ?? 0
  const leavers = LEAVERS.filter((l) => l.locationId === locationId).length
  return {
    location,
    people,
    headcount: people.length,
    plan,
    gap: plan - people.length,
    onNotice: people.filter((e) => e.status === 'notice').length,
    overtime: people.filter((e) => e.overtimeHours > OVERTIME_THRESHOLD).length,
    attendance: people.length
      ? Math.round(people.reduce((s, e) => s + e.attendance, 0) / people.length)
      : 0,
    /** Leavers over the last year against the current roster. */
    turnover: people.length ? Math.round((leavers / people.length) * 100) : 0,
  }
}

export function tenureLabel(months: number) {
  if (months < 12) return `${months} mo`
  const years = Math.floor(months / 12)
  const rest = months % 12
  return rest ? `${years}y ${rest}mo` : `${years}y`
}
