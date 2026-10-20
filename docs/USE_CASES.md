# Use cases: how wide and how deep PairUp goes

PairUp runs one market engine for every kind of local need: a thing someone has, a
job someone does once, or an hour of someone's time. These use cases show the whole
range of markets we aim at. **Width** means how many separate markets one sentence can
reach. **Depth** means how far a single person uses PairUp across a whole year. Each
row names the seed data or feature that supports it today.

Every use case needs a person nearby: a thing changes hands, or someone shows up and
does physical work. Work an AI agent can finish on its own stays out of this list.

## Width: six markets, one engine

| Market | Who needs it | What they say | Unit | In the product today |
|---|---|---|---|---|
| **Used things** | Students who buy each quarter and sell when they move | "I need a graphing calculator today, max $18." · "Anyone selling Stewart Calculus?" | each | TI-84 (live), 20+ textbooks, calculators, lamps, a mini fridge, chargers |
| **Errands** | Anyone short on time, stuck inside or sick | "Bring me cold medicine to McCarty, $5." · "Pick up my parcel from the mailroom." | job | Pharmacy, parcel, printing, laundry, dinner and grocery runs |
| **Hands by the hour** | Anyone moving, cleaning or fixing up a room | "Two hours of moving help with a trolley Friday, up to $12 an hour." | hour | Moving help with a trolley or a van, room cleaning |
| **Organizations hiring for an event** | Student clubs and departments running events | "Robotics showcase Saturday 1–5: registration, AV and a photographer." | hour | Registration desk, AV setup, event photographer, event helpers; overlap-safe scheduling |
| **Neighborhood care** | Residents off campus: renters, travelers, pet owners | "Feed my cat Tuesday and Thursday while I'm away." | job | Cat sitting, plant watering, grocery runs in Capitol Hill, Ballard, Fremont |
| **Needs nobody has said yet** | Everyone with a routine | (nothing: PairUp offers the usual lunch run, or the paper a Bee to-do mentioned) | any | Learned routines, Bee context, watch view; every post waits for a yes |

These markets usually live in separate apps: resale sites, errand apps, handyman
listings, club group chats and neighborhood forums. PairUp gives them one voice
interface, one pairing rule and one trust system.

## Depth: one UW student's year

The same person comes back all year, and needs get larger and more complex over time.

| When | Need | Market | What it shows |
|---|---|---|---|
| September, move-in | A desk lamp, an IKEA table, someone to assemble a bed frame | things + errand | Settling in uses both kinds in one week |
| Start of each quarter | Used textbooks | things | A need that comes back every quarter |
| Every weekday | The lunch run to the HUB | errand | Daily frequency; PairUp learns it and offers it before noon |
| Every week | Laundry drop-off, a grocery run | errand | Repeat jobs from the same trusted helpers |
| A rainy afternoon | "Umbrella at Suzzallo, $5" | things | An urgent need met in minutes at the Suzzallo Hub Locker |
| Sick day | Cold medicine delivered | errand | Over-the-counter is paired; a prescription pickup is refused with a reason |
| Midterms | A graphing calculator today; lecture notes printed and brought to class | things + errand | The TI-84 story; a $3 errand that saves a trip across campus |
| A flat tire | Bike tune-up and puncture repair | errand | A hands-on weekend fix on campus |
| Club event | Three roles for one Saturday | organization | An agent staffs a whole event with no overlapping bookings |
| Wants a Switch | Nobody nearby has one | things | The request waits; Amazon's new price is shown; the next seller is paired at once |
| June, move-out | Sell the mini fridge, hire two hours of van help | things + hour | The year's biggest exchange, in two sentences |
| Summer away | Cat sitting, plant watering | neighborhood | The relationship continues after the quarter ends |

The price range runs from a $1 box of tissues to a $180 game console. How often people
need something runs from every day (lunch) to once a quarter (textbooks) to once a year
(move-out).

## Depth of the engine: each step proves a harder case

| Level | Use case | What the engine does |
|---|---|---|
| 1. Instant pair | TI-84 sold to a buyer with an $18 budget | The price is settled inside both private limits in the same call |
| 2. Standing request | The Switch request waits a day, then is paired when a seller posts | Matching from either side, an Amazon fallback, a push notification to the agent |
| 3. Scheduled service | Saturday 2–6pm event help | The helper's hours must cover the whole job window; a Sunday-only helper stays unmatched |
| 4. Many providers at once | The club's agent hires three roles | Several hourly deals made for one event, with no overlapping bookings for any provider |
| 5. Routine | The lunch run offered before noon | Learned from the user's own past requests; posted only on a yes |
| 6. Ambient | A Bee to-do says "buy printer paper" | The need is extracted from context; other people's words are never stored |
| 7. Safety at every level | A cold-medicine run is paired; a prescription pickup and an alcohol run are refused with a reason; reports pause pairing | The same policy and the same price check apply in every market |

## From campus to any community

UW Seattle is the first market: 52,316 students in autumn 2025, 36,023 of them
undergraduates ([UW Fast Facts](https://www.washington.edu/opb/uw-data/fast-facts-2020-2021/fast-facts-html-only),
[UW News](https://www.washington.edu/news/2025/10/30/washington-residents-make-up-nearly-two-thirds-of-incoming-class-as-enrollment-increases-across-all-three-uw-campuses/)).
That is a dense, walkable community where people move in and out every year.

The seed market already reaches past campus to Capitol Hill, Ballard, Fremont and
Northgate. A new community needs only its areas and meet-up points in
`data/seed-listings.json`: an apartment building, an office campus or another
university runs on the same engine. Secondhand apparel alone is projected to reach
$78.8 billion a year in the US by 2030
([ThredUp 2026 Resale Report, via Retail Dive](https://retaildive.com/news/us-resale-market-surpass-78-billion-in-2030-secondhand/816470/)).
Errands, hourly skills and event staffing come on top of that, in the same market.

## Where each use case appears

| Use case | Video | Judges try it | Seed ready |
|---|---|---|---|
| TI-84 sale | Main story | yes | posted live |
| Club event, three roles | Replaces the single helper beat | yes | yes |
| Switch request that waits | Short beat | yes | Switch seller posted live |
| Lunch routine, Bee, watch | Existing beat | watch view | `seed --lifestyle` |
| Umbrella, cold medicine, move-out van, bike repair, cat sitting | 12-second card montage | yes | yes |
| Prescription pickup refused | Try-it list | yes | yes |
| Textbooks, laundry, parcel | Montage or try-it list | yes | yes |
