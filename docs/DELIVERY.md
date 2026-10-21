# Delivery

PairUp pairs two people directly, and most item deals change hands in person at
an Amazon Hub point. Some buyers want the item brought to them instead: they
live in another neighborhood, they can't make the meet-up time, or the item is
bulky. For those deals PairUp uses Amazon's own delivery network.

## Amazon Hub delivery (built)

1. The buyer picks it. They can say it in the request ("a yoga mat shipped to my
   locker") or switch a proposed deal with `choose_handoff` (`method: "delivery"`).
2. The seller drops the item at an **Amazon Hub Counter** in their area. Amazon
   Shipping takes counter drop-offs with no pickup fee and same-day collection
   for drop-offs before 2 p.m. ([Amazon Shipping locations](https://shipping.amazon.com/locations)).
3. Amazon carries it to an **Amazon Hub Locker** in the buyer's area. The buyer
   collects it with a pickup code.
4. Neither person learns the other's address. Both only see the two Hub points.

How the deal works:

- The price stays the one the fixed pairing rule settled. The buyer pays the
  delivery fee on top, and `deal.total` includes it.
- Switching to delivery asks the seller to confirm again, since a drop-off is a
  different errand from a meet-up.
- `deal.delivery` is on every item deal whose two areas have Hub points, so a
  card can offer the choice. `selected` says whether it is the plan.
- When both sides confirm, the deal gets a shipment reference. The seller gets
  the drop-off label and the buyer gets a pickup code.
- Services keep their own route. An errand is already a delivery by a person.

Demo data: fees and ETAs come from `data/delivery-rates.json` ($3.99 within an
area, $5.99 between areas), and the Hub points are the labelled demo locations
in `data/seed-listings.json`. Shipment references start with `DEMO-`.
Production reads live rates and labels from the Amazon Shipping API and real
locations from the Amazon Hub locator. The carrier limit is 50 lb, and Amazon
Shipping lists drop-off parcels up to 59 × 33 × 33 in.

Code: `deliveryQuote` in `src/market/amazon.ts`, `deliveryView` in
`src/market/views.ts`, `chooseHandoff` in `src/market/service.ts`, tests in
`test/delivery.test.ts`.

## Roadmap: robotic delivery

Robots fit PairUp's short trips: one small item, one campus or neighborhood,
a fixed pickup and drop-off. Each step plugs into the same `handoff` field as a
new method, and the price rule stays the same.

| Stage | What | Why it fits |
|---|---|---|
| 1. Locker-to-locker by Amazon (now) | Amazon Hub delivery, above | Uses Amazon's network, no new hardware |
| 2. Campus sidewalk robots | Partner with a campus robot fleet (Starship runs on 50+ US campuses). The seller loads the robot at their Hub point, the buyer unlocks it at theirs with the pickup code. | Same-campus items under about 20 lb, within about 2 miles, in under an hour |
| 3. Amazon Prime Air drones | When Prime Air serves the area, small items ship by MK30 drone from the seller's Hub drop-off | Packages up to 5 lb; Amazon plans to reach nearly 500 US communities by the end of 2026 |
| 4. Robot-ready Hub points | Hub Lockers that robots and drones can load and unload, so a deal hands off between a person and a robot with no one waiting | Keeps every hand-off at a public, watched place |

What each robotic step needs before launch: a fleet partner's dispatch API, a
size and weight check on the offer, a city or campus permit for the route, and
a fallback to a meet-up when no robot is free.

Sources: [Amazon Shipping locations](https://shipping.amazon.com/locations) ·
[Starship on campuses](https://www.gardnerweb.com/news/robot-delivery-firm-goes-to-school-with-new-funding) ·
[Prime Air expansion](https://www.freightwaves.com/news/amazon-drone-delivery-expansion-targets-500-cities-by-years-end)
