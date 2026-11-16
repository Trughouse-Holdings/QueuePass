//! Parity M1–M3, M9–M13, M15 (`customer-app/src/components/GetTickets.tsx`' seated part, spec 033
//! and 038): the seated panel inside C's frame (`frame.rs`). The price range and the seats left as
//! tiles, the limit line, and Choose seats; then the notes, the HOLD wait, the venue map with the
//! Sections list (`div.venue-map-layout`), and the Your seats box; and the hold log, outside the
//! map's branch. A click on a seat holds or releases it through `core::hold_queue`, one request at
//! a time in click order; every answer goes to `core::reservation::Holds`, which says what the
//! page shows. The live map and the customer's reservations come from `seat_stream.rs`
//! (`withMine`, `core::mine`).
//!
//! The queue lives outside the view's signals, so clicks still queued keep being sent after the
//! page is left (Add to cart), as `use-hold-queue.ts` does; their answers then change nothing.

use std::{cell::RefCell, collections::BTreeMap, rc::Rc, time::Duration};

use customer_rust_core::{
    api::{
        seat_stream::LiveSeatStatus,
        types::{Availability, Event},
    },
    availability::{
        MAX_SEATS, limit_binds, limit_full_note, limit_line, max_quantity, max_seats_note,
        seats_left_label,
    },
    buy::RateLimitedAction,
    format::{count, event_price},
    hold_queue::{ChosenSeat, HoldAnswer, HoldQueue, QueuedAction, SeatAction},
    reservation::{Effects, Holds, seat_with_price},
    seating::{
        map_state::VenueMap as MapData,
        venue_map::{ColorBy, MapSeatInfo, SeatView},
    },
};
use leptos::{prelude::*, task::spawn_local};
use leptos_router::hooks::use_navigate;

use super::frame::{GetTicketsFrame, Panel, WaitMessage, perf_now};
use crate::{
    auth::{Auth, use_auth},
    components::hold_countdown::HoldCountdown,
    device_zone::device_zone,
    seat_stream::{LiveSeats, use_seat_stream},
    venue_map::{SectionsList, VenueMap},
};

/// The Sections list heading's id, the map's skip-link target (`useId()` in React).
const SECTIONS_HEADING: &str = "sections-list-heading";

/// The seated panel: the frame with the seat map inside (interface notes in `frame.rs`).
#[component]
pub fn Seated(
    event: Event,
    #[prop(default = None)] on_sales: Option<Callback<Availability>>,
    #[prop(default = None)] on_event_changed: Option<Callback<Event>>,
) -> impl IntoView {
    let event_id = event.id.to_string();
    let price = event_price(
        &event.base_price,
        event.reserved_seating,
        event.price_max.as_ref().map(|p| p.as_str()),
    );
    let panel = Panel::new(event, on_sales, on_event_changed);
    let open_section = RwSignal::new(None::<String>);
    let live = use_seat_stream(event_id.clone(), open_section.into());
    let seated = SeatedState::new(panel, live, event_id);

    // What the frame shows from the map and the holds (M1, E8).
    Effect::new(move |_| {
        let has_map = live.map.with(Option::is_some);
        let status = live.status.get();
        let loading =
            !has_map && matches!(status, LiveSeatStatus::Loading | LiveSeatStatus::Connecting);
        panel.seats_loading.set(loading);
        panel.seats_failed.set(!has_map && !loading);
        if status == LiveSeatStatus::Missing {
            panel.map_gone();
        }
    });
    Effect::new(move |_| {
        let (held, ran_out, notice) = seated
            .holds
            .with(|h| (h.reservation.is_some(), h.ran_out, h.notice.clone()));
        panel.has_reservation.set(held);
        panel.ran_out.set(ran_out);
        panel.notice.set(notice);
    });
    // The Backend's view of the reservations (line 329): on open and after each read.
    let mine = Memo::new(move |_| {
        live.mine
            .with(|m| m.list().map(<[_]>::to_vec).map(|list| (list, m.at())))
    });
    let page_event = seated.event_id;
    Effect::new(move |_| {
        if let Some((list, at)) = mine.get() {
            let id = page_event.get_value();
            seated
                .holds
                .update(|h| h.on_mine(&list, at, &id, perf_now()));
        }
    });
    // What this page knows ahead of the section's seats lasts until they next change.
    Effect::watch(
        move || live.section.get(),
        move |_, _, _| seated.holds.update(Holds::section_changed),
        false,
    );
    // A venue map after a reconnect may follow a price or layout change: what is left again.
    Effect::watch(
        move || live.maps_after_first.get(),
        move |_, _, _| panel.refresh(),
        false,
    );
    // The countdown's 250 ms ticks, its warning and run-out, and the hold log's clearing.
    let ticker = set_interval_with_handle(
        move || {
            let now = perf_now();
            seated.holds.maybe_update(|h| {
                let before = h.clone();
                h.tick(now);
                h.log.clear_if_due(now);
                *h != before
            });
        },
        Duration::from_millis(250),
    )
    .ok();
    on_cleanup(move || {
        if let Some(t) = ticker {
            t.clear();
        }
    });

    view! {
        <GetTicketsFrame panel>
            {seated_form(seated, price.clone(), open_section)}
        </GetTicketsFrame>
    }
}

/// The panel's own state, outside the frame, so it outlives the frame's other views.
#[derive(Clone, Copy)]
struct SeatedState {
    panel: Panel,
    live: LiveSeats,
    holds: RwSignal<Holds>,
    /// The hold queue's pending actions and whether it is busy, as the view reads them.
    pending: RwSignal<BTreeMap<String, SeatAction>>,
    busy: RwSignal<bool>,
    queue: StoredValue<Rc<RefCell<HoldQueue>>, LocalStorage>,
    event_id: StoredValue<String>,
    auth: Auth,
}

impl SeatedState {
    fn new(panel: Panel, live: LiveSeats, event_id: String) -> Self {
        SeatedState {
            panel,
            live,
            holds: RwSignal::new(Holds::new()),
            pending: RwSignal::new(BTreeMap::new()),
            busy: RwSignal::new(false),
            queue: StoredValue::new_local(Rc::new(RefCell::new(HoldQueue::new()))),
            event_id: StoredValue::new(event_id),
            auth: use_auth(),
        }
    }

    /// The queue changed: the view's copy of it.
    fn show_queue(self, q: &HoldQueue) {
        let _ = self.pending.try_set(q.pending());
        let _ = self.busy.try_set(q.busy());
    }

    /// The seats held once every queued click is answered.
    fn chosen(self) -> usize {
        let pending = self.pending.get();
        self.holds.with(|h| h.will_hold(&pending))
    }

    /// No more seats can be chosen.
    fn full(self) -> bool {
        let max = self
            .panel
            .availability
            .with(|a| a.as_ref().map_or(1, |a| max_quantity(a, None)));
        self.chosen() as u64 >= max
    }

    /// `toggleSeat` (033 FR-001): a click on a seat holds it, or releases it if held.
    fn click(self, seat: &MapSeatInfo) {
        self.holds.update(Holds::click);
        let chosen = ChosenSeat {
            section_id: seat.section_id.clone(),
            section: seat.section.clone(),
            row: seat.row,
            seat: seat.seat,
            row_label: Some(seat.row_label.clone()),
            seat_label: Some(seat.seat_label.clone()),
        };
        let held = self.holds.with_untracked(|h| h.is_held(&chosen.key()));
        let queue = self.queue.get_value();
        let send = queue.borrow_mut().click(chosen, held);
        self.show_queue(&queue.borrow());
        if let Some(action) = send {
            self.send(queue, action);
        }
    }

    /// Sends `action`, and each action queued behind it, one at a time.
    fn send(self, queue: Rc<RefCell<HoldQueue>>, first: QueuedAction) {
        let api = self.auth.api();
        let event_id = self.event_id.get_value();
        spawn_local(async move {
            let mut action = first;
            loop {
                let result = api
                    .send_raw_quiet(action.call(&event_id))
                    .await
                    // A new reservation also has a new `createdAt`, which restarts the countdown
                    // as a 201 does (`Holds::adopt`), so the status is not needed.
                    .map(|body| (200, body));
                let answer = HoldAnswer::from_answer(action.kind, result);
                let answered = queue.borrow_mut().answer(&answer);
                self.show_queue(&queue.borrow());
                self.answered(&action, &answer);
                match answered.and_then(|a| a.next) {
                    Some(next) => action = next,
                    None => break,
                }
            }
        });
    }

    /// What an answer means here (`useHoldQueue`'s handlers).
    fn answered(self, action: &QueuedAction, answer: &HoldAnswer) {
        let live = self.live;
        let section_id_of = move |name: &str| {
            live.map.try_with_untracked(|m| {
                m.as_ref()?
                    .sections
                    .iter()
                    .find(|s| s.name == name)
                    .map(|s| s.section_id.clone())
            })?
        };
        let is_live = live.status.try_get_untracked() == Some(LiveSeatStatus::Live);
        let zone = device_zone();
        let Some(effects) = self.holds.try_update(|h| {
            h.on_answer(action, answer, &section_id_of, is_live, &zone, perf_now())
        }) else {
            // The page is gone; a 401 still signs in again, as the React app's last handlers do.
            if matches!(answer, HoldAnswer::SignedOut) {
                self.auth.sign_in();
            }
            return;
        };
        self.apply(effects);
    }

    fn apply(self, e: Effects) {
        if e.reload_mine {
            self.live.reload_mine.run(());
        }
        if e.refresh_map {
            self.live.refresh.run(());
        }
        if e.reload_availability {
            self.panel.refresh();
        }
        if e.sign_in {
            self.auth.sign_in();
        }
        if let Some(seconds) = e.hold_wait {
            self.panel.start_wait(RateLimitedAction::Hold, seconds);
        }
    }

    /// `seatView` (M9).
    fn seat_view(self, seat: &MapSeatInfo) -> SeatView {
        let key = customer_rust_core::hold_queue::place_key(&seat.section_id, seat.row, seat.seat);
        let hold_waiting = self
            .panel
            .waits
            .with(|w| w.get(RateLimitedAction::Hold).is_some());
        let full = self.full();
        let pending = self.pending.get();
        self.holds
            .with(|h| h.seat_view(&key, seat.state, &pending, hold_waiting, full))
    }
}

/// The form: tiles, the limit line, Choose seats or the map, and the hold log.
fn seated_form(
    s: SeatedState,
    price: String,
    open_section: RwSignal<Option<String>>,
) -> impl IntoView {
    let panel = s.panel;
    let left = Memo::new(move |_| {
        panel
            .availability
            .with(|a| a.as_ref().map_or(0, |a| a.tickets_left))
    });
    let show_map = Memo::new(move |_| {
        let busy = s.busy.get();
        s.holds.with(|h| h.show_map(busy))
    });
    let limit = move || {
        panel
            .availability
            .with(|a| a.as_ref().and_then(limit_line))
            .map(|text| view! { <p class="note">{text}</p> })
    };
    let log_class = move || {
        s.holds
            .with(|h| (!h.log.lines().is_empty()).then_some("note"))
    };
    let log = move || {
        s.holds.with(|h| {
            h.log
                .lines()
                .iter()
                .map(|(_, text)| view! { <p>{text.clone()}</p> })
                .collect_view()
        })
    };
    view! {
        <dl class="stat-tiles">
            <div class="stat-tile">
                <dt class="stat-tile__label">"Price"</dt>
                <dd class="stat-tile__value">{price}</dd>
            </div>
            <div class="stat-tile">
                <dt class="stat-tile__label">{move || seats_left_label(left.get())}</dt>
                <dd class="stat-tile__value">{move || count(left.get() as i64)}</dd>
            </div>
        </dl>
        {limit}
        {move || {
            if show_map.get() {
                map_block(s, open_section).into_any()
            } else {
                view! {
                    <button
                        type="button"
                        class="btn btn--primary"
                        on:click=move |_| s.holds.update(Holds::open_map)
                    >
                        "Choose seats"
                    </button>
                }
                .into_any()
            }
        }}
        <div role="status" aria-atomic="false" data-announces="holds" class=log_class>
            {log}
        </div>
    }
}

/// The notes, the HOLD wait, the map with the Sections list, and Your seats (M3).
fn map_block(s: SeatedState, open_section: RwSignal<Option<String>>) -> impl IntoView {
    let panel = s.panel;
    let live = s.live;
    let focus_seats = RwSignal::new(0_u64);
    let limit_note = move || {
        let full = s.full();
        panel
            .availability
            .with(|a| {
                a.as_ref()
                    .filter(|a| full && limit_binds(a, None))
                    .and_then(limit_full_note)
            })
            .map(|text| view! { <p class="note">{text}</p> })
    };
    let max_note = move || {
        (s.chosen() as u64 >= MAX_SEATS).then(|| view! { <p class="note">{max_seats_note()}</p> })
    };
    let has_map = Memo::new(move |_| live.map.with(Option::is_some));
    let map_view = move || {
        if !has_map.get() {
            return None;
        }
        let first = live.map.get_untracked()?;
        // The map as last had (it is never taken away while the form shows).
        let map: Signal<MapData> = Memo::new(move |prev: Option<&MapData>| {
            live.map
                .get()
                .unwrap_or_else(|| prev.cloned().unwrap_or_else(|| first.clone()))
        })
        .into();
        // A section gone from a new layout (the stream ended on the change) is closed.
        let shown: Signal<Option<String>> = Memo::new(move |_| {
            let open = open_section.get();
            map.with(|m| open.filter(|id| m.sections.iter().any(|x| &x.section_id == id)))
        })
        .into();
        let seat_view = Callback::new(move |seat: MapSeatInfo| s.seat_view(&seat));
        let on_seat = Callback::new(move |seat: MapSeatInfo| s.click(&seat));
        let on_map_open = Callback::new(move |id: Option<String>| open_section.set(id));
        let on_list_open = Callback::new(move |id: Option<String>| {
            let chosen = id.is_some();
            open_section.set(id);
            if chosen {
                focus_seats.update(|n| *n += 1);
            }
        });
        Some(view! {
            <div class="venue-map-layout">
                <VenueMap
                    map
                    color_by=ColorBy::Price
                    open_section_id=shown
                    section=live.section.into()
                    on_open_section=on_map_open
                    seat_view
                    on_seat
                    skip_to=SECTIONS_HEADING
                    focus_seats=Signal::from(focus_seats)
                />
                <SectionsList
                    heading_id=SECTIONS_HEADING
                    map
                    open_section_id=shown
                    on_open_section=on_list_open
                />
            </div>
        })
    };
    let held = Memo::new(move |_| s.holds.with(|h| h.reservation.is_some()));
    view! {
        {limit_note}
        {max_note}
        <WaitMessage kind=RateLimitedAction::Hold/>
        {map_view}
        {move || held.get().then(|| your_seats(s))}
    }
}

/// M11: the Your seats box, directly below the map.
fn your_seats(s: SeatedState) -> impl IntoView {
    let navigate = use_navigate();
    let seconds_left = Signal::derive(move || {
        s.holds.with(|h| {
            h.seconds_left
                .or_else(|| h.reservation.as_ref().map(|r| r.seconds_left))
                .unwrap_or(0)
        })
    });
    let warning = Signal::derive(move || s.holds.with(|h| h.warning));
    let seats = Memo::new(move |_| {
        s.holds.with(|h| {
            h.reservation
                .as_ref()
                .map(|r| {
                    r.seats
                        .iter()
                        .map(|seat| (seat.key(), seat_with_price(seat)))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default()
        })
    });
    let total = move || {
        s.holds.with(|h| {
            h.reservation
                .as_ref()
                .map(|r| format!("Total: {}", r.total()))
                .unwrap_or_default()
        })
    };
    view! {
        <section class="note reservation" aria-labelledby="your-seats-heading">
            <h3 id="your-seats-heading">"Your seats"</h3>
            <HoldCountdown seconds_left warning/>
            <ul aria-label="Held seats">
                <For each=move || seats.get() key=|(key, text)| (key.clone(), text.clone()) let:seat>
                    <li>{seat.1}</li>
                </For>
            </ul>
            <p>{total}</p>
            <button
                type="button"
                class="btn btn--primary"
                on:click=move |_| navigate("/cart", Default::default())
            >
                "Add to cart"
            </button>
        </section>
    }
}
