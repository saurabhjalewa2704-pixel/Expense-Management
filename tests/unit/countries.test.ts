import { describe, expect, it } from "vitest";
import { countryOf, CURRENCIES, flagOf, mentionsTrip } from "@/lib/countries";

describe("countries and booking matching (TRIP-03, TRIP-05)", () => {
  it("a country sets its currency", () => {
    expect(countryOf("US")?.currency).toBe("USD");
    expect(countryOf("jp")?.currency).toBe("JPY");
    expect(CURRENCIES).toContain("EUR");
  });
  it("flags", () => expect(flagOf("US")).toBe("🇺🇸"));
  it("an earlier expense mentions the destination, a stop or an airport code", () => {
    const usa = { name: "USA", country_code: "US" };
    const stops = [{ name: "Chicago" }, { name: "New York" }, { name: "Miami" }];
    expect(mentionsTrip("United ORD–LGA", usa, stops)).toBe(true);                   // airport codes
    expect(mentionsTrip("British Airways LHR–ORD, MIA–LHR", usa, stops)).toBe(true);
    expect(mentionsTrip("The Hoxton Williamsburg New York · 7 nights", usa, stops)).toBe(true);   // a stop
    expect(mentionsTrip("Kimpton Angler's Miami", usa, stops)).toBe(true);
    expect(mentionsTrip("easyJet LGW–EDI", usa, stops)).toBe(false);                 // Edinburgh is not on this trip
    expect(mentionsTrip("Tesco", usa, stops)).toBe(false);
    expect(mentionsTrip("Visit USA ESTA", usa, stops)).toBe(true);                   // the trip's own name
  });
});
