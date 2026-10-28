// TRIP-03: the country picker. A country sets the default local currency; its major airports help spot earlier bookings (TRIP-05).
export interface Country { code: string; name: string; currency: string; airports: string[] }

export const COUNTRIES: Country[] = [
  { code: "GB", name: "United Kingdom", currency: "GBP", airports: ["LHR", "LGW", "STN", "LTN", "MAN", "EDI", "BHX", "GLA", "BRS", "NCL", "LPL", "LCY"] },
  { code: "US", name: "United States", currency: "USD", airports: ["JFK", "LGA", "EWR", "ORD", "MDW", "LAX", "SFO", "MIA", "BOS", "IAD", "DCA", "ATL", "SEA", "LAS", "DFW", "IAH", "DEN", "MCO", "FLL"] },
  { code: "CA", name: "Canada", currency: "CAD", airports: ["YYZ", "YVR", "YUL", "YYC", "YOW"] },
  { code: "MX", name: "Mexico", currency: "MXN", airports: ["MEX", "CUN", "GDL"] },
  { code: "IE", name: "Ireland", currency: "EUR", airports: ["DUB", "ORK", "SNN"] },
  { code: "FR", name: "France", currency: "EUR", airports: ["CDG", "ORY", "NCE", "LYS", "MRS", "TLS", "BOD"] },
  { code: "ES", name: "Spain", currency: "EUR", airports: ["MAD", "BCN", "AGP", "PMI", "ALC", "VLC", "SVQ", "IBZ", "TFS", "LPA"] },
  { code: "PT", name: "Portugal", currency: "EUR", airports: ["LIS", "OPO", "FAO", "FNC"] },
  { code: "IT", name: "Italy", currency: "EUR", airports: ["FCO", "CIA", "MXP", "LIN", "VCE", "NAP", "BLQ", "PSA", "FLR", "CTA", "PMO"] },
  { code: "DE", name: "Germany", currency: "EUR", airports: ["FRA", "MUC", "BER", "HAM", "DUS", "CGN", "STR"] },
  { code: "NL", name: "Netherlands", currency: "EUR", airports: ["AMS", "RTM", "EIN"] },
  { code: "BE", name: "Belgium", currency: "EUR", airports: ["BRU", "CRL"] },
  { code: "AT", name: "Austria", currency: "EUR", airports: ["VIE", "SZG", "INN"] },
  { code: "GR", name: "Greece", currency: "EUR", airports: ["ATH", "SKG", "HER", "RHO", "CFU", "JMK", "JTR"] },
  { code: "CH", name: "Switzerland", currency: "CHF", airports: ["ZRH", "GVA", "BSL"] },
  { code: "SE", name: "Sweden", currency: "SEK", airports: ["ARN", "GOT"] },
  { code: "NO", name: "Norway", currency: "NOK", airports: ["OSL", "BGO"] },
  { code: "DK", name: "Denmark", currency: "DKK", airports: ["CPH", "BLL"] },
  { code: "FI", name: "Finland", currency: "EUR", airports: ["HEL"] },
  { code: "IS", name: "Iceland", currency: "ISK", airports: ["KEF"] },
  { code: "PL", name: "Poland", currency: "PLN", airports: ["WAW", "KRK", "GDN"] },
  { code: "CZ", name: "Czechia", currency: "CZK", airports: ["PRG"] },
  { code: "HU", name: "Hungary", currency: "HUF", airports: ["BUD"] },
  { code: "HR", name: "Croatia", currency: "EUR", airports: ["ZAG", "SPU", "DBV"] },
  { code: "TR", name: "Türkiye", currency: "TRY", airports: ["IST", "SAW", "AYT", "DLM", "BJV"] },
  { code: "MT", name: "Malta", currency: "EUR", airports: ["MLA"] },
  { code: "CY", name: "Cyprus", currency: "EUR", airports: ["LCA", "PFO"] },
  { code: "MA", name: "Morocco", currency: "MAD", airports: ["RAK", "CMN", "AGA"] },
  { code: "EG", name: "Egypt", currency: "EGP", airports: ["CAI", "HRG", "SSH"] },
  { code: "ZA", name: "South Africa", currency: "ZAR", airports: ["JNB", "CPT", "DUR"] },
  { code: "KE", name: "Kenya", currency: "KES", airports: ["NBO", "MBA"] },
  { code: "AE", name: "United Arab Emirates", currency: "AED", airports: ["DXB", "AUH", "DWC"] },
  { code: "QA", name: "Qatar", currency: "QAR", airports: ["DOH"] },
  { code: "IL", name: "Israel", currency: "ILS", airports: ["TLV"] },
  { code: "IN", name: "India", currency: "INR", airports: ["DEL", "BOM", "BLR", "GOI", "MAA", "HYD", "CCU"] },
  { code: "LK", name: "Sri Lanka", currency: "LKR", airports: ["CMB"] },
  { code: "TH", name: "Thailand", currency: "THB", airports: ["BKK", "DMK", "HKT", "CNX", "USM"] },
  { code: "VN", name: "Vietnam", currency: "VND", airports: ["SGN", "HAN", "DAD"] },
  { code: "ID", name: "Indonesia", currency: "IDR", airports: ["DPS", "CGK"] },
  { code: "MY", name: "Malaysia", currency: "MYR", airports: ["KUL", "PEN"] },
  { code: "SG", name: "Singapore", currency: "SGD", airports: ["SIN"] },
  { code: "PH", name: "Philippines", currency: "PHP", airports: ["MNL", "CEB"] },
  { code: "HK", name: "Hong Kong", currency: "HKD", airports: ["HKG"] },
  { code: "CN", name: "China", currency: "CNY", airports: ["PEK", "PVG", "CAN", "CTU"] },
  { code: "JP", name: "Japan", currency: "JPY", airports: ["HND", "NRT", "KIX", "ITM", "FUK", "CTS"] },
  { code: "KR", name: "South Korea", currency: "KRW", airports: ["ICN", "GMP", "PUS"] },
  { code: "AU", name: "Australia", currency: "AUD", airports: ["SYD", "MEL", "BNE", "PER", "ADL", "CNS"] },
  { code: "NZ", name: "New Zealand", currency: "NZD", airports: ["AKL", "WLG", "CHC", "ZQN"] },
  { code: "BR", name: "Brazil", currency: "BRL", airports: ["GRU", "GIG", "BSB"] },
  { code: "AR", name: "Argentina", currency: "ARS", airports: ["EZE", "AEP"] },
  { code: "CL", name: "Chile", currency: "CLP", airports: ["SCL"] },
  { code: "PE", name: "Peru", currency: "PEN", airports: ["LIM", "CUZ"] },
  { code: "CO", name: "Colombia", currency: "COP", airports: ["BOG", "MDE", "CTG"] },
  { code: "CU", name: "Cuba", currency: "CUP", airports: ["HAV"] },
  { code: "JM", name: "Jamaica", currency: "JMD", airports: ["MBJ", "KIN"] },
  { code: "BB", name: "Barbados", currency: "BBD", airports: ["BGI"] },
  { code: "MV", name: "Maldives", currency: "MVR", airports: ["MLE"] },
  { code: "MU", name: "Mauritius", currency: "MUR", airports: ["MRU"] },
  { code: "NP", name: "Nepal", currency: "NPR", airports: ["KTM"] },
];

export const countryOf = (code: string | null | undefined) => COUNTRIES.find((c) => c.code === (code ?? "").toUpperCase());
/** A flag emoji from the two-letter code. */
export const flagOf = (code: string | null | undefined): string => (code && /^[A-Za-z]{2}$/.test(code) ? String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0))) : "");

/** The currencies offered in the currency picker: those of the countries above, plus a few common ones, alphabetically. */
export const CURRENCIES: string[] = [...new Set([...COUNTRIES.map((c) => c.currency), "USD", "EUR", "GBP"])].sort();

/** TRIP-05: does an earlier expense look like it belongs to this trip? Its payee or note mentions the destination, a stop, or an airport code. */
export function mentionsTrip(text: string, trip: { name: string; country_code: string | null }, stops: readonly { name: string }[]): boolean {
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  const words = [trip.name, countryOf(trip.country_code)?.name ?? "", ...stops.map((s) => s.name)].map((w) => w.toLowerCase().trim()).filter((w) => w.length >= 3);
  if (words.some((w) => t.includes(` ${w.replace(/[^a-z0-9]+/g, " ")} `))) return true;
  const codes = countryOf(trip.country_code)?.airports ?? [];
  return codes.some((c) => t.includes(` ${c.toLowerCase()} `));
}
