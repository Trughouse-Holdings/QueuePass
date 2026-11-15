//! Spec 037 T027 (research R6): the cases of the React Admin app's time tests, ported.
//!
//! - `packages/shared/test/time-zone.test.ts` (spec 020 R2, R3, R9, R11, R12, SC-004)
//! - `packages/shared/test/doors-open.test.ts` (spec 025 R2, R9); `doors-open-types.test.ts` is a
//!   type-level check of the contract (`doorsOpenAt` required), which the generated API types
//!   carry, so it has no case here
//! - `admin-app/test/event-form-times.test.ts` (spec 036 FR-003, FR-005, FR-009, FR-010)
//! - `admin-app/test/event-default-times.test.tsx` (036 FR-017), its pure logic
//! - `admin-app/test/event-form.tz.test.tsx` and `times.tz.test.tsx` (020 FR-014 to FR-026), their
//!   pure logic
//! - `admin-app/test/format.test.ts` (spec 030 FR-001)
//!
//! Every assertion is an exact value. The `fixtures/time/*.tsv` files are the TypeScript functions'
//! own outputs under Node 22's `Intl` (written by `fixtures/time/generate.mts`), so the Rust text
//! is byte-identical to the React app's.

use admin_rust_core::format::{
    SOURCE_TEXT, doors_open, has_ended, removed_note, removed_short, seat_label, source_text,
    until, venue_zone, when,
};
use admin_rust_core::time::*;
use chrono::{DateTime, Utc};

fn at(iso: &str) -> DateTime<Utc> {
    parse_instant(iso).unwrap_or_else(|| panic!("not an instant: {iso}"))
}

fn iso(instant: DateTime<Utc>) -> String {
    to_iso_string(instant)
}

const MIN_MS: i64 = 60_000;

fn plus_minutes(iso_text: &str, minutes: i64) -> DateTime<Utc> {
    instant_from_ms(at(iso_text).timestamp_millis() + minutes * MIN_MS).unwrap()
}

// ------------------------------------------------------------------ time-zone.test.ts

mod us_time_zones {
    use super::*;

    #[test]
    fn is_exactly_the_eight_zones_in_order_with_their_names() {
        let got: Vec<(&str, &str)> = US_TIME_ZONES.iter().map(|z| (z.id, z.name)).collect();
        assert_eq!(
            got,
            vec![
                ("America/New_York", "Eastern Time"),
                ("America/Chicago", "Central Time"),
                ("America/Denver", "Mountain Time"),
                ("America/Phoenix", "Arizona Time (no daylight saving)"),
                ("America/Los_Angeles", "Pacific Time"),
                ("America/Anchorage", "Alaska Time"),
                ("America/Adak", "Hawaii-Aleutian Time"),
                ("Pacific/Honolulu", "Hawaii Time"),
            ]
        );
    }

    #[test]
    fn defaults_to_eastern_time() {
        assert_eq!(DEFAULT_TIME_ZONE, "America/New_York");
    }

    #[test]
    fn is_us_time_zone_accepts_each_zone() {
        for z in US_TIME_ZONES.iter() {
            assert!(is_us_time_zone(z.id), "{}", z.id);
        }
    }

    #[test]
    fn is_us_time_zone_refuses_others() {
        for value in ["America/Kentucky/Louisville", "UTC", "", "america/new_york"] {
            assert!(!is_us_time_zone(value), "{value}");
        }
    }

    #[test]
    fn names_a_zone() {
        assert_eq!(
            zone_name("America/Phoenix"),
            "Arizona Time (no daylight saving)"
        );
        assert_eq!(zone_name("America/New_York"), "Eastern Time");
        // `?? zone`: an unknown zone is shown as its own name.
        assert_eq!(zone_name("Europe/Paris"), "Europe/Paris");
    }
}

mod state_time_zones {
    use super::*;

    const US_STATES: [&str; 51] = [
        "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN",
        "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH",
        "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT",
        "VT", "VA", "WA", "WV", "WI", "WY",
    ];

    const SPLIT: [(&str, [&str; 2]); 15] = [
        ("AK", ["America/Anchorage", "America/Adak"]),
        ("AZ", ["America/Phoenix", "America/Denver"]),
        ("FL", ["America/New_York", "America/Chicago"]),
        ("ID", ["America/Denver", "America/Los_Angeles"]),
        ("IN", ["America/New_York", "America/Chicago"]),
        ("KS", ["America/Chicago", "America/Denver"]),
        ("KY", ["America/New_York", "America/Chicago"]),
        ("MI", ["America/New_York", "America/Chicago"]),
        ("NE", ["America/Chicago", "America/Denver"]),
        ("NV", ["America/Los_Angeles", "America/Denver"]),
        ("ND", ["America/Chicago", "America/Denver"]),
        ("OR", ["America/Los_Angeles", "America/Denver"]),
        ("SD", ["America/Chicago", "America/Denver"]),
        ("TN", ["America/Chicago", "America/New_York"]),
        ("TX", ["America/Chicago", "America/Denver"]),
    ];

    #[test]
    fn has_exactly_us_states_51_codes() {
        let mut keys: Vec<&str> = STATE_TIME_ZONES.iter().map(|(s, _)| *s).collect();
        keys.sort_unstable();
        let mut want = US_STATES.to_vec();
        want.sort_unstable();
        assert_eq!(keys, want);
    }

    #[test]
    fn lists_two_zones_exactly_for_the_15_split_states_in_r3_order() {
        let mut split: Vec<(&str, Vec<&str>)> = STATE_TIME_ZONES
            .iter()
            .filter(|(_, zones)| zones.len() > 1)
            .map(|(s, zones)| (*s, zones.to_vec()))
            .collect();
        split.sort();
        let mut want: Vec<(&str, Vec<&str>)> =
            SPLIT.iter().map(|(s, z)| (*s, z.to_vec())).collect();
        want.sort();
        assert_eq!(split, want);
    }

    #[test]
    fn gives_every_other_state_one_zone() {
        for (state, zones) in STATE_TIME_ZONES.iter() {
            if !SPLIT.iter().any(|(s, _)| s == state) {
                assert_eq!(zones.len(), 1, "{state}");
            }
        }
        assert_eq!(state_time_zones("HI"), Some(&["Pacific/Honolulu"][..]));
        assert_eq!(state_time_zones("CA"), Some(&["America/Los_Angeles"][..]));
        assert_eq!(state_time_zones("WA"), Some(&["America/Los_Angeles"][..]));
        assert_eq!(state_time_zones("CO"), Some(&["America/Denver"][..]));
        assert_eq!(state_time_zones("IL"), Some(&["America/Chicago"][..]));
        assert_eq!(state_time_zones("OH"), Some(&["America/New_York"][..]));
        assert_eq!(state_time_zones("DC"), Some(&["America/New_York"][..]));
        assert_eq!(state_time_zones("ZZ"), None);
    }

    #[test]
    fn uses_only_zones_on_us_time_zones() {
        for (_, zones) in STATE_TIME_ZONES.iter() {
            for zone in zones.iter() {
                assert!(is_us_time_zone(zone), "{zone}");
            }
        }
    }
}

/// The minutes of one local day, `YYYY-MM-DDTHH:mm`.
fn minutes_of(date: &str) -> Vec<String> {
    let mut out = Vec::with_capacity(1440);
    for h in 0..24 {
        for m in 0..60 {
            out.push(format!("{date}T{h:02}:{m:02}"));
        }
    }
    out
}

const DAYLIGHT: [(&str, Option<(&str, &str)>); 7] = [
    ("America/New_York", Some(("EDT", "EST"))),
    ("America/Chicago", Some(("CDT", "CST"))),
    ("America/Denver", Some(("MDT", "MST"))),
    ("America/Phoenix", None),
    ("America/Los_Angeles", Some(("PDT", "PST"))),
    ("America/Anchorage", Some(("AKDT", "AKST"))),
    ("Pacific/Honolulu", None),
];

mod resolve_local_sc_004 {
    use super::*;

    #[test]
    fn round_trips_every_minute_of_2027_03_14_skipping_exactly_02_00_to_02_59() {
        for (zone, abbrs) in DAYLIGHT {
            for local in minutes_of("2027-03-14") {
                let r = resolve_local(&local, zone).unwrap();
                let in_gap = abbrs.is_some()
                    && local.as_str() >= "2027-03-14T02:00"
                    && local.as_str() <= "2027-03-14T02:59";
                if in_gap {
                    assert_eq!(
                        r,
                        ResolvedLocal::Skipped {
                            skipped_from: "02:00".into(),
                            skipped_to: "03:00".into()
                        },
                        "{zone} {local}"
                    );
                } else {
                    let ResolvedLocal::Ok(moment) = r else {
                        panic!("{zone} {local}: {r:?}");
                    };
                    assert_eq!(to_local_date_time(moment.instant, zone), local);
                }
            }
        }
    }

    #[test]
    fn round_trips_every_minute_of_2027_11_07_repeating_exactly_01_00_to_01_59() {
        for (zone, abbrs) in DAYLIGHT {
            for local in minutes_of("2027-11-07") {
                let r = resolve_local(&local, zone).unwrap();
                let repeated = abbrs.is_some()
                    && local.as_str() >= "2027-11-07T01:00"
                    && local.as_str() <= "2027-11-07T01:59";
                if let Some((daylight, standard)) = abbrs.filter(|_| repeated) {
                    let ResolvedLocal::Repeated { first, second } = r else {
                        panic!("{zone} {local}: {r:?}");
                    };
                    assert_eq!(
                        second.instant.timestamp_millis() - first.instant.timestamp_millis(),
                        3_600_000
                    );
                    assert_eq!(first.abbreviation, daylight);
                    assert_eq!(second.abbreviation, standard);
                    assert_eq!(to_local_date_time(first.instant, zone), local);
                    assert_eq!(to_local_date_time(second.instant, zone), local);
                } else {
                    let ResolvedLocal::Ok(moment) = r else {
                        panic!("{zone} {local}: {r:?}");
                    };
                    assert_eq!(to_local_date_time(moment.instant, zone), local);
                }
            }
        }
    }

    #[test]
    fn names_the_boundaries() {
        let cases = [
            ("2027-03-14T01:59", "ok"),
            ("2027-03-14T02:00", "skipped"),
            ("2027-03-14T02:59", "skipped"),
            ("2027-03-14T03:00", "ok"),
            ("2027-11-07T00:59", "ok"),
            ("2027-11-07T01:00", "repeated"),
            ("2027-11-07T01:59", "repeated"),
            ("2027-11-07T02:00", "ok"),
        ];
        for (zone, abbrs) in DAYLIGHT {
            if abbrs.is_some() {
                for (local, kind) in cases {
                    assert_eq!(
                        resolve_local(local, zone).unwrap().kind(),
                        kind,
                        "{zone} {local}"
                    );
                }
            } else {
                for local in ["2027-03-14T02:30", "2027-11-07T01:30"] {
                    assert_eq!(
                        resolve_local(local, zone).unwrap().kind(),
                        "ok",
                        "{zone} {local}"
                    );
                }
            }
        }
    }

    #[test]
    fn adak_skips_and_repeats_with_hadt_and_hast() {
        assert_eq!(
            resolve_local("2027-03-14T02:30", "America/Adak").unwrap(),
            ResolvedLocal::Skipped {
                skipped_from: "02:00".into(),
                skipped_to: "03:00".into()
            }
        );
        let ResolvedLocal::Repeated { first, second } =
            resolve_local("2027-11-07T01:30", "America/Adak").unwrap()
        else {
            panic!("not repeated");
        };
        assert_eq!([first.abbreviation, second.abbreviation], ["HADT", "HAST"]);
        assert_eq!([first.offset, second.offset], ["-09:00", "-10:00"]);
    }
}

mod resolve_local_moments {
    use super::*;

    #[test]
    fn gives_the_instant_offset_and_abbreviation() {
        assert_eq!(
            resolve_local("2026-10-01T19:00", "America/New_York").unwrap(),
            ResolvedLocal::Ok(Moment {
                instant: at("2026-10-01T23:00:00Z"),
                offset: "-04:00".into(),
                abbreviation: "EDT".into(),
            })
        );
    }

    #[test]
    fn reads_seconds_and_fractions() {
        let ResolvedLocal::Ok(m) =
            resolve_local("2026-10-01T19:00:30.250", "America/New_York").unwrap()
        else {
            panic!("not ok");
        };
        assert_eq!(iso(m.instant), "2026-10-01T23:00:30.250Z");
        // Fractions past milliseconds are cut, as `Date` keeps milliseconds.
        let ResolvedLocal::Ok(m) =
            resolve_local("2026-10-01T19:00:00.1234", "America/New_York").unwrap()
        else {
            panic!("not ok");
        };
        assert_eq!(iso(m.instant), "2026-10-01T23:00:00.123Z");
    }

    #[test]
    fn puts_the_earlier_moment_first_for_a_repeated_time() {
        assert_eq!(
            resolve_local("2027-11-07T01:30", "America/New_York").unwrap(),
            ResolvedLocal::Repeated {
                first: Moment {
                    instant: at("2027-11-07T05:30:00Z"),
                    offset: "-04:00".into(),
                    abbreviation: "EDT".into(),
                },
                second: Moment {
                    instant: at("2027-11-07T06:30:00Z"),
                    offset: "-05:00".into(),
                    abbreviation: "EST".into(),
                },
            }
        );
    }

    #[test]
    fn refuses_a_malformed_local_time() {
        for local in [
            "2026-10-01",
            "2026-10-01 19:00",
            "2026-13-01T19:00",
            "2026-02-30T19:00",
            "x",
            // `Date.UTC` reads years 0-99 as 1900-1999, so they never read back the same.
            "0050-01-01T00:00",
        ] {
            let err = resolve_local(local, "America/New_York").unwrap_err();
            assert_eq!(err.to_string(), format!("Not a local date-time: {local}"));
        }
    }

    #[test]
    fn refuses_an_unknown_zone_as_intl_does() {
        let err = resolve_local("2026-10-01T19:00", "Foo/Bar").unwrap_err();
        assert_eq!(err.to_string(), "Invalid time zone specified: Foo/Bar");
    }

    #[test]
    fn skipped_in_chicago_too() {
        assert_eq!(
            resolve_local("2027-03-14T02:30", "America/Chicago").unwrap(),
            ResolvedLocal::Skipped {
                skipped_from: "02:00".into(),
                skipped_to: "03:00".into()
            }
        );
    }
}

mod offset_and_abbreviation_r2_table {
    use super::*;

    #[test]
    fn july_and_december_in_each_zone() {
        let july = at("2026-07-01T12:00:00Z");
        let december = at("2026-12-01T12:00:00Z");
        let table = [
            ("America/New_York", -240, "EDT", -300, "EST"),
            ("America/Chicago", -300, "CDT", -360, "CST"),
            ("America/Denver", -360, "MDT", -420, "MST"),
            ("America/Phoenix", -420, "MST", -420, "MST"),
            ("America/Los_Angeles", -420, "PDT", -480, "PST"),
            ("America/Anchorage", -480, "AKDT", -540, "AKST"),
            ("America/Adak", -540, "HADT", -600, "HAST"),
            ("Pacific/Honolulu", -600, "HST", -600, "HST"),
        ];
        for (zone, jo, ja, d_o, da) in table {
            assert_eq!(offset_at(july, zone).unwrap(), jo, "{zone}");
            assert_eq!(abbreviation_at(july, zone), ja, "{zone}");
            assert_eq!(offset_at(december, zone).unwrap(), d_o, "{zone}");
            assert_eq!(abbreviation_at(december, zone), da, "{zone}");
        }
    }

    #[test]
    fn takes_an_iso_string_as_well() {
        assert_eq!(
            offset_at(at("2026-07-01T12:00:00Z"), "America/New_York").unwrap(),
            -240
        );
    }

    #[test]
    fn formats_an_offset() {
        assert_eq!(format_offset(-240), "-04:00");
        assert_eq!(format_offset(330), "+05:30");
        assert_eq!(format_offset(0), "+00:00");
        assert_eq!(format_offset(-570), "-09:30");
    }

    #[test]
    fn refuses_an_unknown_zone() {
        let err = offset_at(at("2026-01-01T00:00:00Z"), "Foo/Bar").unwrap_err();
        assert_eq!(err.to_string(), "Invalid time zone specified: Foo/Bar");
    }

    /// Every zone `Intl` lists, and common links, in January and July 2026: the abbreviation a
    /// viewer's own time is shown with (FR-023), byte for byte, and the offset.
    #[test]
    fn matches_intl_for_every_zone() {
        let fixture = include_str!("fixtures/time/abbreviations.tsv");
        let mut checked = 0;
        for line in fixture.lines() {
            let cols: Vec<&str> = line.split('\t').collect();
            let [zone, instant, abbr, offset] = cols[..] else {
                panic!("bad fixture line: {line}");
            };
            let t = at(instant);
            assert_eq!(
                abbreviation_at(t, zone),
                abbr,
                "abbreviation in {zone} at {instant}"
            );
            let got = match offset_at(t, zone) {
                Ok(m) => m.to_string(),
                Err(e) => format!("ERR {e}"),
            };
            assert_eq!(got, offset, "offset in {zone} at {instant}");
            checked += 1;
        }
        assert!(checked > 900, "{checked}");
    }
}

mod to_offset_date_time_cases {
    use super::*;

    #[test]
    fn states_an_instant_in_the_venue_offset() {
        assert_eq!(
            to_offset_date_time(at("2026-10-01T23:00:00Z"), "America/New_York").unwrap(),
            "2026-10-01T19:00:00-04:00"
        );
        assert_eq!(
            to_offset_date_time(at("2026-12-05T01:00:00Z"), "America/New_York").unwrap(),
            "2026-12-04T20:00:00-05:00"
        );
    }

    #[test]
    fn tells_the_two_1_30_am_moments_of_2027_11_07_apart() {
        assert_eq!(
            to_offset_date_time(at("2027-11-07T05:30:00Z"), "America/New_York").unwrap(),
            "2027-11-07T01:30:00-04:00"
        );
        assert_eq!(
            to_offset_date_time(at("2027-11-07T06:30:00Z"), "America/New_York").unwrap(),
            "2027-11-07T01:30:00-05:00"
        );
    }

    #[test]
    fn round_trips_through_parse_offset_date_time() {
        let sent = to_offset_date_time(at("2027-11-07T06:30:00Z"), "America/New_York").unwrap();
        assert_eq!(
            parse_offset_date_time(&sent),
            Some(OffsetDateTimeParts {
                local: "2027-11-07T01:30:00".into(),
                offset_minutes: -300
            })
        );
    }
}

mod parse_offset_date_time_cases {
    use super::*;

    #[test]
    fn reads() {
        for (s, local, offset_minutes) in [
            ("2026-10-01T19:00:00-04:00", "2026-10-01T19:00:00", -240),
            ("2026-10-01T19:00-04:00", "2026-10-01T19:00:00", -240),
            (
                "2026-10-01T19:00:00.123-04:00",
                "2026-10-01T19:00:00.123",
                -240,
            ),
            ("2026-10-01T19:00:00Z", "2026-10-01T19:00:00", 0),
            ("2026-10-01T19:00:00+05:30", "2026-10-01T19:00:00", 330),
            (
                "2026-10-01T19:00:00.123456789+00:00",
                "2026-10-01T19:00:00.123456789",
                0,
            ),
        ] {
            assert_eq!(
                parse_offset_date_time(s),
                Some(OffsetDateTimeParts {
                    local: local.into(),
                    offset_minutes
                }),
                "{s}"
            );
        }
    }

    #[test]
    fn refuses() {
        for s in [
            "2026-10-01T19:00:00",
            "2026-10-01",
            "2026-10-01 19:00:00-04:00",
            "2026-10-01T24:00:00-04:00",
            "2026-10-01T19:60:00-04:00",
            "2026-02-30T19:00:00-04:00",
            "2026-10-01T19:00:00-24:00",
            "garbage",
            "",
            "0050-10-01T19:00:00Z",
        ] {
            assert_eq!(parse_offset_date_time(s), None, "{s}");
        }
    }
}

mod local_date_time_cases {
    use super::*;

    #[test]
    fn shows_local_midnight_as_t00_00() {
        assert_eq!(
            to_local_date_time(at("2026-10-02T04:00:00Z"), "America/New_York"),
            "2026-10-02T00:00"
        );
        assert_eq!(
            to_local_date_time(at("2026-10-02T00:00:00Z"), "America/New_York"),
            "2026-10-01T20:00"
        );
    }

    #[test]
    fn gives_the_venue_local_date() {
        // 9:00 PM PDT on Oct 1 is already Oct 2 in UTC and in Eastern time (US1 scenario 6).
        assert_eq!(
            local_date(at("2026-10-02T04:00:00Z"), "America/Los_Angeles"),
            "2026-10-01"
        );
        assert_eq!(
            local_date(at("2026-10-02T04:00:00Z"), "America/New_York"),
            "2026-10-02"
        );
    }

    #[test]
    fn writes_a_year_before_1000_unpadded_as_intl_does() {
        // `year: 'numeric'` gives "999", so the local value is cut short, as in the React app.
        assert_eq!(
            to_local_date_time(at("0999-06-01T12:00:00Z"), "UTC"),
            "999-06-01T12:00:"
        );
        assert_eq!(
            format_event_time(at("0999-06-01T12:00:00Z"), "UTC"),
            "Jun 1, 999, 12:00 PM UTC"
        );
    }
}

mod formatters_r11_r12 {
    use super::*;

    #[test]
    fn formats_an_event_time_with_its_abbreviation() {
        let t = at("2026-10-01T23:00:00Z");
        assert_eq!(
            format_event_time(t, "America/New_York"),
            "Oct 1, 2026, 7:00 PM EDT"
        );
        assert_eq!(format_time_of_day(t, "America/New_York"), "7:00 PM EDT");
        assert_eq!(format_event_date(t, "America/New_York"), "Oct 1, 2026");
    }

    #[test]
    fn uses_est_in_winter_and_mst_all_year_in_phoenix() {
        assert_eq!(
            format_event_time(at("2026-12-06T01:00:00Z"), "America/New_York"),
            "Dec 5, 2026, 8:00 PM EST"
        );
        assert_eq!(
            format_event_time(at("2026-07-02T02:00:00Z"), "America/Phoenix"),
            "Jul 1, 2026, 7:00 PM MST"
        );
    }

    #[test]
    fn gives_an_event_across_midnight_two_dates() {
        let start = at("2026-10-02T02:00:00Z"); // 10:00 PM EDT on Oct 1
        let end = at("2026-10-02T05:00:00Z"); // 1:00 AM EDT on Oct 2
        assert_eq!(format_event_date(start, "America/New_York"), "Oct 1, 2026");
        assert_eq!(format_event_date(end, "America/New_York"), "Oct 2, 2026");
        assert_eq!(
            format_event_time(end, "America/New_York"),
            "Oct 2, 2026, 1:00 AM EDT"
        );
    }

    #[test]
    fn formats_12_05_am_and_12_30_pm() {
        assert_eq!(
            format_time_of_day(at("2026-10-01T04:05:00Z"), "America/New_York"),
            "12:05 AM EDT"
        );
        assert_eq!(
            format_time_of_day(at("2026-10-01T16:30:00Z"), "America/New_York"),
            "12:30 PM EDT"
        );
    }

    #[test]
    fn formats_a_time_before_standard_time_as_intl_does() {
        // Local mean time: ICU's GMT form with seconds; before 1970, no "EDT" name.
        assert_eq!(
            format_time_of_day(at("1850-06-01T12:00:00Z"), "America/New_York"),
            "7:03 AM GMT-4:56:02"
        );
        assert_eq!(
            format_event_time(at("1960-06-01T12:00:00Z"), "America/New_York"),
            "Jun 1, 1960, 8:00 AM GMT-4"
        );
    }

    /// The US zones across both 2027 clock changes and a summer and winter day, byte for byte.
    #[test]
    fn match_intl_across_the_clock_changes() {
        let fixture = include_str!("fixtures/time/formats.tsv");
        let mut checked = 0;
        for line in fixture.lines() {
            let cols: Vec<&str> = line.split('\t').collect();
            let [zone, instant, event_time, offset_form, local] = cols[..] else {
                panic!("bad fixture line: {line}");
            };
            let t = at(instant);
            assert_eq!(format_event_time(t, zone), event_time, "{zone} {instant}");
            assert_eq!(
                format_time_of_day(t, zone),
                event_time.splitn(3, ", ").nth(2).unwrap(),
                "{zone} {instant}"
            );
            assert_eq!(
                to_offset_date_time(t, zone).unwrap(),
                offset_form,
                "{zone} {instant}"
            );
            assert_eq!(to_local_date_time(t, zone), local, "{zone} {instant}");
            checked += 1;
        }
        assert!(checked > 1000, "{checked}");
    }

    /// FR-023: a time that belongs to no event, in the viewer's own zone (passed in by the app
    /// crate, research R6), byte for byte with `formatViewerTime` under that `TZ`.
    #[test]
    fn formats_a_viewer_time_in_the_device_zone() {
        let fixture = include_str!("fixtures/time/viewer.tsv");
        for line in fixture.lines() {
            let cols: Vec<&str> = line.split('\t').collect();
            let [zone, instant, time, dated] = cols[..] else {
                panic!("bad fixture line: {line}");
            };
            assert_eq!(format_viewer_time(at(instant), zone, false), time, "{zone}");
            assert_eq!(format_viewer_time(at(instant), zone, true), dated, "{zone}");
        }
        assert_eq!(
            format_viewer_time(at("2026-10-01T23:42:00Z"), "America/Los_Angeles", false),
            "4:42 PM PDT"
        );
    }
}

mod r9_message_helpers {
    use super::*;

    #[test]
    fn states_a_skipped_time_as_the_backend_and_the_form_say_it() {
        assert_eq!(
            skipped_time_message("2027-03-14T02:30", "America/New_York", "02:00", "03:00"),
            "2:30 AM on Mar 14, 2027 doesn't exist in Eastern Time: clocks jump from 2:00 AM to 3:00 AM. Choose another time."
        );
        assert_eq!(
            skipped_time_message("2027-03-14T02:05", "America/Adak", "02:00", "03:00"),
            "2:05 AM on Mar 14, 2027 doesn't exist in Hawaii-Aleutian Time: clocks jump from 2:00 AM to 3:00 AM. Choose another time."
        );
    }

    #[test]
    fn formats_a_local_wall_time_and_date_without_any_zone() {
        assert_eq!(format_local_time("2027-11-07T01:30"), "1:30 AM");
        assert_eq!(format_local_time("2026-10-01T19:00:59"), "7:00 PM");
        assert_eq!(format_local_time("2026-10-01T00:05"), "12:05 AM");
        assert_eq!(format_local_time("2026-10-01T12:00"), "12:00 PM");
        assert_eq!(
            format_local_date_time("2027-03-14T02:30"),
            "Mar 14, 2027, 2:30 AM"
        );
    }

    #[test]
    fn formats_an_end_with_its_date_only_when_its_local_date_differs() {
        let start = at("2026-10-01T23:00:00Z"); // 7:00 PM EDT
        assert_eq!(
            format_event_end(start, at("2026-10-02T02:00:00Z"), "America/New_York"),
            "10:00 PM EDT"
        );
        assert_eq!(
            format_event_end(
                at("2026-10-02T02:00:00Z"),
                at("2026-10-02T05:00:00Z"),
                "America/New_York"
            ),
            "Oct 2, 2026, 1:00 AM EDT"
        );
    }
}

/// Review round 2, m4: before standard time (1883) the offset has seconds; it is unknown, never 0.
mod an_offset_in_seconds {
    use super::*;

    #[test]
    fn is_refused_as_unknown_not_read_as_utc() {
        let msg = "No whole-minute UTC offset in America/New_York at that time: GMT-04:56:02";
        let t = at("1850-06-01T12:00:00Z");
        assert_eq!(
            offset_at(t, "America/New_York").unwrap_err().to_string(),
            msg
        );
        assert_eq!(
            to_offset_date_time(t, "America/New_York")
                .unwrap_err()
                .to_string(),
            msg
        );
        assert_eq!(
            resolve_local("1850-06-01T08:00", "America/New_York")
                .unwrap_err()
                .to_string(),
            msg
        );
    }

    #[test]
    fn still_reads_utc_itself_as_0() {
        assert_eq!(offset_at(at("2026-10-01T12:00:00Z"), "UTC").unwrap(), 0);
    }
}

mod instants {
    use super::*;

    #[test]
    fn reads_what_date_reads() {
        assert_eq!(
            iso(at("2026-11-01T23:00:00.000Z")),
            "2026-11-01T23:00:00.000Z"
        );
        assert_eq!(iso(at("2026-10-01T19:00Z")), "2026-10-01T19:00:00.000Z");
        assert_eq!(iso(at("2026-10-01")), "2026-10-01T00:00:00.000Z");
        assert_eq!(
            iso(at("2026-10-01T19:00:00.123456Z")),
            "2026-10-01T19:00:00.123Z"
        );
        assert_eq!(
            iso(at("2026-10-01T19:00:00.5-04:00")),
            "2026-10-01T23:00:00.500Z"
        );
        assert_eq!(
            iso(at("2026-10-01T19:00:00+0400")),
            "2026-10-01T15:00:00.000Z"
        );
        assert_eq!(iso(at("2026-10-01T24:00:00Z")), "2026-10-02T00:00:00.000Z");
        // V8 rolls Feb 30 over to Mar 2.
        assert_eq!(iso(at("2026-02-30T00:00:00Z")), "2026-03-02T00:00:00.000Z");
        assert_eq!(
            at("2026-10-01T19:00:00Z").timestamp_millis(),
            1_790_881_200_000
        );
    }

    #[test]
    fn refuses_what_is_not_an_instant() {
        for s in ["garbage", "", "2026-13-01T00:00:00Z", "2026-10-01T19:00:00"] {
            assert_eq!(parse_instant(s), None, "{s}");
        }
    }
}

// ------------------------------------------------------------------ doors-open.test.ts

mod doors_open_constants_r2 {
    use super::*;

    #[test]
    fn are_60_360_and_60_minutes() {
        assert_eq!(DEFAULT_DOORS_BEFORE_START_MINUTES, 60);
        assert_eq!(DOORS_OPEN_MAX_BEFORE_START_MINUTES, 360);
        assert_eq!(ENTRY_OPENS_BEFORE_DOORS_MINUTES, 60);
        assert_eq!(CHECK_IN_RETENTION_DAYS, 7);
    }
}

mod doors_open_problem_fr_004 {
    use super::*;

    const START: &str = "2026-11-21T00:00:00.000Z";

    #[test]
    fn allows_doors_at_the_start() {
        assert_eq!(doors_open_problem(at(START), at(START)), None);
    }

    #[test]
    fn allows_doors_exactly_6_hours_before() {
        assert_eq!(
            doors_open_problem(at(START), plus_minutes(START, -360)),
            None
        );
    }

    #[test]
    fn refuses_6_hours_1_minute_before_as_too_early() {
        let p = doors_open_problem(at(START), plus_minutes(START, -361));
        assert_eq!(p, Some(DoorsOpenProblem::TooEarly));
        assert_eq!(p.unwrap().as_str(), "TOO_EARLY");
    }

    #[test]
    fn refuses_1_minute_after_the_start_as_after_start() {
        let p = doors_open_problem(at(START), plus_minutes(START, 1));
        assert_eq!(p, Some(DoorsOpenProblem::AfterStart));
        assert_eq!(p.unwrap().as_str(), "AFTER_START");
    }

    #[test]
    fn measures_elapsed_time_across_the_spring_forward_night() {
        // 7:00 AM EDT is 11:00Z; 6 elapsed hours earlier is 05:00Z, 12:00 AM EST.
        assert_eq!(
            doors_open_problem(at("2027-03-14T11:00:00Z"), at("2027-03-14T05:00:00Z")),
            None
        );
        assert_eq!(
            doors_open_problem(at("2027-03-14T11:00:00Z"), at("2027-03-14T04:59:00Z")),
            Some(DoorsOpenProblem::TooEarly)
        );
    }
}

mod doors_open_range_message_r2 {
    use super::*;

    #[test]
    fn names_the_range_in_the_venue_zone_the_date_once_when_it_is_one_day() {
        assert_eq!(
            doors_open_range_message(at("2026-11-21T00:00:00Z"), "America/New_York"),
            "Doors must open no more than 6 hours before the start and not after it: between Nov 20, 2026, 1:00 PM EST and 7:00 PM EST."
        );
    }

    #[test]
    fn repeats_the_date_when_the_range_crosses_midnight() {
        assert_eq!(
            doors_open_range_message(at("2026-11-21T08:00:00Z"), "America/New_York"),
            "Doors must open no more than 6 hours before the start and not after it: between Nov 20, 2026, 9:00 PM EST and Nov 21, 2026, 3:00 AM EST."
        );
    }

    #[test]
    fn reads_in_another_zone() {
        assert_eq!(
            doors_open_range_message(at("2026-11-21T01:00:00Z"), "America/Chicago"),
            "Doors must open no more than 6 hours before the start and not after it: between Nov 20, 2026, 1:00 PM CST and 7:00 PM CST."
        );
    }
}

mod format_doors_open_r9 {
    use super::*;

    #[test]
    fn shows_the_time_alone_on_the_start_local_date() {
        assert_eq!(
            format_doors_open(
                at("2026-11-21T00:00:00Z"),
                at("2026-11-20T22:30:00Z"),
                "America/New_York"
            ),
            "5:30 PM EST"
        );
    }

    #[test]
    fn shows_the_date_and_time_when_doors_open_the_day_before() {
        assert_eq!(
            format_doors_open(
                at("2026-11-20T06:00:00Z"),
                at("2026-11-20T04:30:00Z"),
                "America/New_York"
            ),
            "Nov 19, 2026, 11:30 PM EST"
        );
    }
}

// ------------------------------------------------------------------ event-form-times.test.ts

mod doors_offset_list_036_fr_003 {
    use super::*;

    #[test]
    fn is_every_15_minutes_from_0_to_6_hours_with_the_default_on_the_list() {
        let list = doors_offset_minutes_list();
        assert_eq!(list[0], 0);
        assert_eq!(*list.last().unwrap(), 360);
        assert_eq!(list.len(), 25);
        assert!(list.contains(&DEFAULT_DOORS_OFFSET_MINUTES));
        assert!(list.contains(&90));
        assert_eq!(DOORS_OFFSET_STEP_MINUTES, 15);
        assert_eq!(DOORS_OFFSET_MAX_MINUTES, 360);
        assert_eq!(DEFAULT_DOORS_OFFSET_MINUTES, 60);
        assert!(list.windows(2).all(|w| w[1] - w[0] == 15));
    }

    #[test]
    fn names_each_length() {
        assert_eq!(doors_offset_label(0), "At the start");
        assert_eq!(doors_offset_label(15), "15 minutes before");
        assert_eq!(doors_offset_label(60), "1 hour before");
        assert_eq!(doors_offset_label(90), "1 hour 30 minutes before");
        assert_eq!(doors_offset_label(135), "2 hours 15 minutes before");
        assert_eq!(doors_offset_label(360), "6 hours before");
        // Off the list, as the TypeScript writes them.
        assert_eq!(doors_offset_label(375), "6 hours 15 minutes before");
        assert_eq!(doors_offset_label(5), "5 minutes before");
        assert_eq!(doors_offset_label(120), "2 hours before");
        assert_eq!(doors_offset_label(-30), " before");
    }

    #[test]
    fn pairs_each_length_with_its_label() {
        let options = doors_offset_options();
        assert_eq!(options.len(), 25);
        assert_eq!(
            options[..3],
            [
                DoorsOffsetOption {
                    minutes: 0,
                    label: "At the start".into()
                },
                DoorsOffsetOption {
                    minutes: 15,
                    label: "15 minutes before".into()
                },
                DoorsOffsetOption {
                    minutes: 30,
                    label: "30 minutes before".into()
                },
            ]
        );
    }
}

mod edit_mode_from_a_stored_gap_036_fr_005 {
    use super::*;

    #[test]
    fn uses_before_the_start_for_90_minutes_and_at_a_set_time_for_10() {
        assert_eq!(doors_mode_for_stored_gap_ms(90 * 60_000), DoorsMode::Before);
        assert!(is_exact_doors_offset_minutes(90));
        assert_eq!(doors_mode_for_stored_gap_ms(10 * 60_000), DoorsMode::AtTime);
        assert_eq!(
            doors_mode_for_stored_gap_ms(90 * 60_000 + 1),
            DoorsMode::AtTime
        );
        assert_eq!(doors_mode_for_stored_gap_ms(-60_000), DoorsMode::AtTime);
        assert_eq!(
            doors_mode_for_stored_gap_ms(375 * 60_000),
            DoorsMode::AtTime
        );
        assert_eq!(DoorsMode::Before.as_str(), "before");
        assert_eq!(DoorsMode::AtTime.as_str(), "at-time");
        assert!(!is_exact_doors_offset_minutes(-15));
        assert!(!is_exact_doors_offset_minutes(361));
        assert!(is_exact_doors_offset_minutes(0));
        assert!(is_exact_doors_offset_minutes(360));
    }
}

mod elapsed_time_036_fr_009 {
    use super::*;

    #[test]
    fn two_hours_before_3_30_am_after_spring_forward_is_12_30_am() {
        // 2027-03-14, America/New_York: 02:00 EST becomes 03:00 EDT.
        let start = at("2027-03-14T07:30:00.000Z"); // 3:30 AM EDT
        let doors = doors_instant_before_start(start, 120);
        assert_eq!(
            to_offset_date_time(doors, "America/New_York").unwrap(),
            "2027-03-14T00:30:00-05:00"
        );
        assert_eq!(
            doors_open_at_preview(doors, "America/New_York", None),
            "Doors open at 12:30 AM EST"
        );
    }

    #[test]
    fn says_the_day_before_when_doors_fall_on_the_day_before() {
        assert_eq!(
            doors_open_at_preview(
                at("2026-11-20T04:30:00Z"),
                "America/New_York",
                Some(at("2026-11-20T06:00:00Z"))
            ),
            "Doors open at 11:30 PM EST the day before"
        );
        assert_eq!(
            doors_open_at_preview(
                at("2026-11-20T22:30:00Z"),
                "America/New_York",
                Some(at("2026-11-21T00:00:00Z"))
            ),
            "Doors open at 5:30 PM EST"
        );
    }
}

mod joining_a_date_and_a_time_036_fr_010 {
    use super::*;

    fn parts(date: &str, time: &str) -> LocalDateTimeParts {
        LocalDateTimeParts {
            date: date.into(),
            time: time.into(),
        }
    }

    #[test]
    fn splits_and_joins_and_is_empty_until_both_parts_are_present() {
        assert_eq!(
            split_local_date_time("2026-11-20T19:00"),
            parts("2026-11-20", "19:00")
        );
        assert_eq!(
            join_local_date_time("2026-11-20", "19:00"),
            "2026-11-20T19:00"
        );
        assert_eq!(join_local_date_time("2026-11-20", ""), "");
        assert_eq!(join_local_date_time("", "19:00"), "");
        assert_eq!(split_local_date_time(""), parts("", ""));
        assert_eq!(
            join_local_date_time("2026-11-20", "19:00:00"),
            "2026-11-20T19:00"
        );
        assert_eq!(split_local_date_time("2026-11-20"), parts("2026-11-20", ""));
        assert_eq!(
            split_local_date_time("2026-11-20T19:00:30.000"),
            parts("2026-11-20", "19:00")
        );
        assert_eq!(split_local_date_time("T1"), parts("", "1"));
    }
}

// ------------------------------------------------------------------ event-default-times.test.tsx

mod default_event_instants_036_fr_017 {
    use super::*;

    #[test]
    fn starts_at_the_next_whole_hour_and_ends_4_hours_later() {
        for (now, start, end) in [
            (
                "2026-11-10T17:41:00Z",
                "2026-11-10T18:00:00.000Z",
                "2026-11-10T22:00:00.000Z",
            ),
            (
                "2026-11-10T18:00:00Z",
                "2026-11-10T19:00:00.000Z",
                "2026-11-10T23:00:00.000Z",
            ),
            (
                "2026-11-11T04:30:00Z",
                "2026-11-11T05:00:00.000Z",
                "2026-11-11T09:00:00.000Z",
            ),
        ] {
            let d = default_event_instants(at(now));
            assert_eq!(iso(d.starts_at), start, "{now}");
            assert_eq!(iso(d.ends_at), end, "{now}");
        }
        assert_eq!(DEFAULT_EVENT_LENGTH_MINUTES, 240);
    }

    #[test]
    fn at_12_41_pm_eastern_starts_today_at_1_pm_and_ends_at_5_pm() {
        let d = default_event_instants(at("2026-11-10T17:41:00Z"));
        assert_eq!(
            to_local_date_time(d.starts_at, "America/New_York"),
            "2026-11-10T13:00"
        );
        assert_eq!(
            to_local_date_time(d.ends_at, "America/New_York"),
            "2026-11-10T17:00"
        );
    }

    #[test]
    fn in_another_zone_the_same_instants_read_in_that_zone() {
        let d = default_event_instants(at("2026-11-10T17:41:00Z"));
        let zone = "America/Chicago";
        // 18:00Z is 12:00 PM CST.
        assert_eq!(to_local_date_time(d.starts_at, zone), "2026-11-10T12:00");
        assert_eq!(to_local_date_time(d.ends_at, zone), "2026-11-10T16:00");
        let doors = doors_instant_before_start(d.starts_at, DEFAULT_DOORS_OFFSET_MINUTES);
        assert_eq!(
            doors_open_at_preview(doors, zone, None),
            "Doors open at 11:00 AM CST"
        );
        assert_eq!(
            to_offset_date_time(d.starts_at, zone).unwrap(),
            "2026-11-10T12:00:00-06:00"
        );
        assert_eq!(
            to_offset_date_time(d.ends_at, zone).unwrap(),
            "2026-11-10T16:00:00-06:00"
        );
        assert_eq!(
            to_offset_date_time(doors, zone).unwrap(),
            "2026-11-10T11:00:00-06:00"
        );
    }

    #[test]
    fn late_at_night_the_next_whole_hour_is_tomorrow() {
        let d = default_event_instants(at("2026-11-11T04:30:00Z")); // 11:30 PM EST on Nov 10
        assert_eq!(
            to_local_date_time(d.starts_at, "America/New_York"),
            "2026-11-11T00:00"
        );
        assert_eq!(
            to_local_date_time(d.ends_at, "America/New_York"),
            "2026-11-11T04:00"
        );
    }

    #[test]
    fn on_a_fall_back_night_the_default_is_the_first_time_and_4_hours_is_elapsed() {
        let zone = "America/Chicago";
        let d = default_event_instants(at("2027-11-07T05:30:00Z")); // 12:30 AM CDT
        // 06:00Z is the first 1:00 AM (CDT); 4 elapsed hours later is 4:00 AM CST.
        assert_eq!(to_local_date_time(d.starts_at, zone), "2027-11-07T01:00");
        let ResolvedLocal::Repeated { first, second } =
            resolve_local("2027-11-07T01:00", zone).unwrap()
        else {
            panic!("not repeated");
        };
        assert_eq!(first.instant, d.starts_at);
        assert_eq!(
            format!(
                "{} {} (the first time)",
                format_local_time("2027-11-07T01:00"),
                first.abbreviation
            ),
            "1:00 AM CDT (the first time)"
        );
        assert_eq!(to_local_date_time(d.ends_at, zone), "2027-11-07T04:00");
        // Choosing the second 1:00 AM (CST, 07:00Z) moves Ends to 11:00Z, 5:00 AM CST.
        let end = instant_from_ms(
            second.instant.timestamp_millis() + DEFAULT_EVENT_LENGTH_MINUTES * MIN_MS,
        )
        .unwrap();
        assert_eq!(second.abbreviation, "CST");
        assert_eq!(to_local_date_time(end, zone), "2027-11-07T05:00");
    }

    #[test]
    fn ends_follows_an_edited_start_in_elapsed_time_across_a_fall_back_night() {
        let zone = "America/Chicago";
        // 11:00 PM CDT on Nov 6, 2027 is 04:00Z; 4 hours later is 08:00Z, 2:00 AM CST.
        let ResolvedLocal::Ok(start) = resolve_local("2027-11-06T23:00", zone).unwrap() else {
            panic!("not ok");
        };
        assert_eq!(iso(start.instant), "2027-11-07T04:00:00.000Z");
        let end = instant_from_ms(
            start.instant.timestamp_millis() + DEFAULT_EVENT_LENGTH_MINUTES * MIN_MS,
        )
        .unwrap();
        assert_eq!(to_local_date_time(end, zone), "2027-11-07T02:00");
    }
}

// ------------------------------------------------------------------ event-form.tz.test.tsx

mod event_form_zone_logic_020 {
    use super::*;

    fn ok(local: &str, zone: &str) -> Moment {
        match resolve_local(local, zone).unwrap() {
            ResolvedLocal::Ok(m) => m,
            other => panic!("{local} in {zone}: {other:?}"),
        }
    }

    #[test]
    fn the_zone_line_takes_the_abbreviation_in_force_on_the_typed_date() {
        assert_eq!(
            ok("2026-10-01T19:00", "America/New_York").abbreviation,
            "EDT"
        );
        assert_eq!(
            ok("2026-12-05T20:00", "America/New_York").abbreviation,
            "EST"
        );
        assert_eq!(zone_name("America/New_York"), "Eastern Time");
    }

    #[test]
    fn sends_typed_times_with_the_venue_offset() {
        let sent =
            |local: &str, zone: &str| to_offset_date_time(ok(local, zone).instant, zone).unwrap();
        assert_eq!(
            sent("2026-10-01T19:00", "America/New_York"),
            "2026-10-01T19:00:00-04:00"
        );
        assert_eq!(
            sent("2026-10-01T22:00", "America/New_York"),
            "2026-10-01T22:00:00-04:00"
        );
        // The same typed times after the venue changes to Pacific.
        assert_eq!(
            sent("2026-10-01T19:00", "America/Los_Angeles"),
            "2026-10-01T19:00:00-07:00"
        );
        assert_eq!(
            sent("2026-10-01T22:00", "America/Los_Angeles"),
            "2026-10-01T22:00:00-07:00"
        );
    }

    #[test]
    fn refuses_a_skipped_time_with_the_react_message() {
        let ResolvedLocal::Skipped {
            skipped_from,
            skipped_to,
        } = resolve_local("2027-03-14T02:30", "America/New_York").unwrap()
        else {
            panic!("not skipped");
        };
        assert_eq!(
            skipped_time_message(
                "2027-03-14T02:30",
                "America/New_York",
                &skipped_from,
                &skipped_to
            ),
            "2:30 AM on Mar 14, 2027 doesn't exist in Eastern Time: clocks jump from 2:00 AM to 3:00 AM. Choose another time."
        );
    }

    #[test]
    fn accepts_the_same_time_at_phoenix_and_doors_follow_the_start() {
        let start = ok("2027-03-14T02:30", "America/Phoenix");
        assert_eq!(
            to_offset_date_time(start.instant, "America/Phoenix").unwrap(),
            "2027-03-14T02:30:00-07:00"
        );
        let doors = doors_instant_before_start(start.instant, 60);
        assert_eq!(
            to_offset_date_time(doors, "America/Phoenix").unwrap(),
            "2027-03-14T01:30:00-07:00"
        );
        assert_eq!(
            doors_open_at_preview(doors, "America/Phoenix", None),
            "Doors open at 1:30 AM MST"
        );
    }

    #[test]
    fn a_repeated_time_is_chosen_by_its_offset() {
        let ResolvedLocal::Repeated { first, second } =
            resolve_local("2027-11-07T01:30", "America/New_York").unwrap()
        else {
            panic!("not repeated");
        };
        let time = format_local_time("2027-11-07T01:30");
        assert_eq!(format!("Which {time}?"), "Which 1:30 AM?");
        assert_eq!(
            format!("{time} {} (the first time)", first.abbreviation),
            "1:30 AM EDT (the first time)"
        );
        assert_eq!(
            format!("{time} {} (the second time)", second.abbreviation),
            "1:30 AM EST (the second time)"
        );
        assert_eq!(
            to_offset_date_time(second.instant, "America/New_York").unwrap(),
            "2027-11-07T01:30:00-05:00"
        );
        assert_eq!(
            to_offset_date_time(first.instant, "America/New_York").unwrap(),
            "2027-11-07T01:30:00-04:00"
        );
        assert_eq!(
            to_offset_date_time(
                ok("2027-11-07T03:30", "America/New_York").instant,
                "America/New_York"
            )
            .unwrap(),
            "2027-11-07T03:30:00-05:00"
        );
    }

    #[test]
    fn a_stored_instant_with_seconds_picks_its_own_occurrence() {
        for (stored, offset) in [
            ("2027-11-07T05:30:30.000Z", "-04:00"),
            ("2027-11-07T06:30:30.000Z", "-05:00"),
        ] {
            let t = at(stored);
            assert_eq!(
                to_local_date_time(t, "America/New_York"),
                "2027-11-07T01:30"
            );
            assert_eq!(
                format_offset(offset_at(t, "America/New_York").unwrap()),
                offset
            );
        }
    }

    #[test]
    fn shows_a_stored_event_in_its_venue_local_time() {
        assert_eq!(
            to_local_date_time(at("2026-10-02T02:00:00.000Z"), "America/Los_Angeles"),
            "2026-10-01T19:00"
        );
        assert_eq!(
            to_local_date_time(at("2026-10-02T05:00:00.000Z"), "America/Los_Angeles"),
            "2026-10-01T22:00"
        );
        assert_eq!(
            abbreviation_at(at("2026-10-02T02:00:00.000Z"), "America/Los_Angeles"),
            "PDT"
        );
    }

    #[test]
    fn keeps_a_fall_back_night_first_1_30_am_at_a_central_venue_as_cdt() {
        let zone = "America/Chicago";
        let start = at("2027-11-07T06:30:00.000Z");
        let end = at("2027-11-07T09:30:00.000Z");
        assert_eq!(to_local_date_time(start, zone), "2027-11-07T01:30");
        assert_eq!(abbreviation_at(start, zone), "CDT");
        assert_eq!(
            to_offset_date_time(start, zone).unwrap(),
            "2027-11-07T01:30:00-05:00"
        );
        assert_eq!(
            to_offset_date_time(end, zone).unwrap(),
            "2027-11-07T03:30:00-06:00"
        );
    }

    #[test]
    fn after_a_venue_change_the_repeated_hour_is_sent_in_the_new_zone() {
        let ResolvedLocal::Repeated { second, .. } =
            resolve_local("2027-11-07T01:30", "America/Chicago").unwrap()
        else {
            panic!("not repeated");
        };
        assert_eq!(
            to_offset_date_time(second.instant, "America/Chicago").unwrap(),
            "2027-11-07T01:30:00-06:00"
        );
    }

    #[test]
    fn names_the_conflicting_event_times_in_the_venue_zone() {
        let (s, e) = ("2026-10-01T23:00:00.000Z", "2026-10-02T02:00:00.000Z");
        let zone = Some("America/New_York");
        assert_eq!(
            format!(
                "Conflicts with X, which runs {} – {}.",
                when(s, zone),
                until(s, e, zone)
            ),
            "Conflicts with X, which runs Oct 1, 2026, 7:00 PM EDT – 10:00 PM EDT."
        );
    }
}

// ------------------------------------------------------------------ times.tz.test.tsx

mod admin_pages_show_venue_times_020_r12 {
    use super::*;

    #[test]
    fn each_event_in_its_venue_zone() {
        for (zone, start, end, times, starts, ends) in [
            (
                "America/New_York",
                "2026-10-01T23:00:00.000Z",
                "2026-10-02T02:00:00.000Z",
                "7:00 PM EDT – 10:00 PM EDT",
                "Oct 1, 2026, 7:00 PM EDT",
                "Oct 1, 2026, 10:00 PM EDT",
            ),
            (
                "America/Phoenix",
                "2026-10-02T02:00:00.000Z",
                "2026-10-02T05:00:00.000Z",
                "7:00 PM MST – 10:00 PM MST",
                "Oct 1, 2026, 7:00 PM MST",
                "Oct 1, 2026, 10:00 PM MST",
            ),
            (
                "Pacific/Honolulu",
                "2026-10-02T05:00:00.000Z",
                "2026-10-02T08:00:00.000Z",
                "7:00 PM HST – 10:00 PM HST",
                "Oct 1, 2026, 7:00 PM HST",
                "Oct 1, 2026, 10:00 PM HST",
            ),
        ] {
            assert_eq!(format_event_date(at(start), zone), "Oct 1, 2026");
            assert_eq!(
                format!(
                    "{} – {}",
                    format_time_of_day(at(start), zone),
                    until(start, end, Some(zone))
                ),
                times
            );
            assert_eq!(when(start, Some(zone)), starts);
            assert_eq!(when(end, Some(zone)), ends);
        }
    }

    #[test]
    fn gives_an_event_across_midnight_its_end_date() {
        let zone = "America/New_York";
        let (start, end) = ("2026-10-02T02:00:00.000Z", "2026-10-02T05:00:00.000Z");
        assert_eq!(
            format!(
                "{} – {}",
                format_time_of_day(at(start), zone),
                until(start, end, Some(zone))
            ),
            "10:00 PM EDT – Oct 2, 2026, 1:00 AM EDT"
        );
    }

    #[test]
    fn attendees_checked_in_time_in_the_venue_zone() {
        // ORDERS' first ticket was checked in at 22:45Z on Nov 1: 12:45 PM HST.
        assert_eq!(
            when("2026-11-01T22:45:00.000Z", Some("Pacific/Honolulu")),
            "Nov 1, 2026, 12:45 PM HST"
        );
    }

    #[test]
    fn reports_dates_each_event_in_its_venue_zone() {
        // 9:00 PM PDT on Oct 1 is Oct 2 in UTC and in Eastern time.
        let t = at("2026-10-02T04:00:00.000Z");
        assert_eq!(format_event_date(t, "America/Los_Angeles"), "Oct 1, 2026");
        assert_eq!(format_event_date(t, "America/New_York"), "Oct 2, 2026");
    }
}

// ------------------------------------------------------------------ format.ts (format.test.ts)

mod has_ended_030_fr_001 {
    use super::*;

    const END: &str = "2026-11-10T03:00:00.000Z";

    #[test]
    fn is_false_one_millisecond_before_the_end() {
        let end = at(END).timestamp_millis();
        assert!(!has_ended(END, end - 1));
    }

    #[test]
    fn is_true_at_the_end_exactly_and_after() {
        let end = at(END).timestamp_millis();
        assert!(has_ended(END, end));
        assert!(has_ended(END, end + 60_000));
    }

    #[test]
    fn is_false_for_a_time_date_cannot_read() {
        // `Date.parse` gives NaN, and `NaN <= now` is false.
        assert!(!has_ended("garbage", i64::MAX));
    }
}

mod format_ts {
    use super::*;

    #[test]
    fn when_reads_a_missing_zone_as_eastern() {
        let t = "2026-11-01T23:00:00.000Z";
        assert_eq!(when(t, None), "Nov 1, 2026, 6:00 PM EST");
        assert_eq!(when(t, Some("")), "Nov 1, 2026, 6:00 PM EST");
        assert_eq!(
            when(t, Some("Pacific/Honolulu")),
            "Nov 1, 2026, 1:00 PM HST"
        );
    }

    #[test]
    fn until_gives_the_date_only_when_it_differs() {
        assert_eq!(
            until("2026-11-01T23:00:00.000Z", "2026-11-02T02:00:00.000Z", None),
            "9:00 PM EST"
        );
        assert_eq!(
            until(
                "2026-11-01T23:00:00.000Z",
                "2026-11-02T06:00:00.000Z",
                Some("America/Chicago")
            ),
            "Nov 2, 2026, 12:00 AM CST"
        );
    }

    #[test]
    fn seat_label_reads_section_row_seat() {
        assert_eq!(seat_label("115", "F", "7"), "Section 115, Row F, Seat 7");
    }

    #[test]
    fn venue_zone_names_the_zone_and_how_it_was_set() {
        assert_eq!(
            venue_zone(Some("America/Phoenix"), Some("STATE")),
            "Arizona Time (no daylight saving), from the state"
        );
        assert_eq!(venue_zone(None, None), "Eastern Time, the default");
        // `??` keeps an empty zone, and an unknown source reads "undefined", as in TypeScript.
        assert_eq!(venue_zone(Some(""), Some("BOGUS")), ", undefined");
        assert_eq!(
            SOURCE_TEXT,
            [
                ("ADDRESS", "from the address"),
                ("STATE", "from the state"),
                ("ADMIN", "chosen by an admin"),
                ("DEFAULT", "the default"),
            ]
        );
        assert_eq!(source_text("ADMIN"), Some("chosen by an admin"));
        assert_eq!(source_text("admin"), None);
    }

    #[test]
    fn doors_open_beside_the_start() {
        assert_eq!(
            doors_open("2026-11-01T23:00:00.000Z", "2026-11-01T22:00:00.000Z", None),
            "5:00 PM EST"
        );
        assert_eq!(
            doors_open("2026-11-20T06:00:00Z", "2026-11-20T04:30:00Z", None),
            "Nov 19, 2026, 11:30 PM EST"
        );
    }

    #[test]
    fn removed_note_and_short_name_the_date_in_the_venue_zone() {
        assert_eq!(
            removed_note("2026-11-09T15:00:00.000Z", None),
            "Check-in details removed on Nov 9, 2026 (kept for 7 days after the event)."
        );
        assert_eq!(
            removed_short("2026-11-10T03:00:00.000Z", Some("America/Los_Angeles")),
            "Details removed Nov 9, 2026"
        );
    }
}
