# Impact: why PairUp matters

PairUp makes three promises:

1. **Faster and cheaper to buy what you need.** One sentence finds the thing or the
   helper nearby, the price settles inside both private limits, and the whole price
   reaches the person on the other side.
2. **Make personal business great.** Anyone with a spare calculator, a free afternoon
   or a trolley runs a small business by voice: no storefront, no listing form, no
   commission on the deal.
3. **C2C in the future.** Personal agents will buy and sell for the people they work
   for. PairUp is the open, safe meeting point where those agents pair people, with a
   published price rule and a human yes on every deal.

This page collects the evidence behind each promise: the pain people have today, the
size of the markets, what one exchange saves, and how we will measure it. Every
figure links to its source. Figures we model ourselves are marked **(model)** and
show their inputs.

## The pain today

| Pain | Evidence | What PairUp does |
|---|---|---|
| **Selling costs a big share of a small sale** | Poshmark keeps 20% of sales of $15 and up ([Closo](https://closo.co/blogs/fees/poshmark-seller-fee-2025-complete-guide-to-payouts-fees-profit-margins)); Mercari charges 10% plus 2.9% + $0.30 for payment ([Closo](https://closo.co/blogs/fees/mercari-fee-2025-full-breakdown-comparison-with-ebay-seller-fees)); eBay's final value fee runs about 12.9–15% plus $0.30 per order ([Closo](https://closo.co/blogs/fees/ebay-final-sale-fee-2025-complete-guide-to-ebay-s-final-value-fee-how-it-affects-your-profit)). | The agreed price goes from buyer to seller in full at the hand-off. |
| **Small errands cost more than the errand** | A $39 Panda Express family meal was $47.10 on DoorDash, Grubhub and Uber Eats before service fees ([Star Tribune](https://www.startribune.com/article/600169619)); grocery items on delivery apps averaged 11% above in-store prices, plus delivery fees ([CHOICE](https://www.choice.com.au/shopping/everyday-shopping/supermarkets/articles/doordash-milkrun-and-uber-eats-grocery-delivery-costs-compared)). Hiring help adds a percentage service fee and a Trust & Support fee on each hour ([Taskrabbit](https://support.taskrabbit.com/hc/en-us/articles/204411610-What-s-the-Taskrabbit-Service-Fee-)). | The requester names the fee; the neighbor who walks keeps all of it. A $4 lunch run is worth doing. |
| **Buying from strangers feels risky** | Americans reported $12.5 billion in fraud losses in 2024, up 25%; online shopping was the second most reported category, with $432 million lost ([FTC data via SecurityWeek](https://www.securityweek.com/fraud-losses-reached-12-5-billion-in-2024-ftc/)). In a 2020 BBB survey, 50% of Facebook Marketplace users said scammers had targeted them ([Bitdefender summary](https://bitdefender.com/en-us/blog/hotforsecurity/how-to-protect-against-scams-on-facebook-marketplace)). | Signed-in accounts, a price check that warns about prices far below normal, ratings, reports that pause pairing, meet-ups at public Amazon Hub points, and payment at the hand-off. |
| **Haggling and back-and-forth** | Resale chats run offer by offer, and a seller's floor leaks through repeated low offers. | One fixed rule in [pairing-core](https://github.com/rairurairu/pairing-core) settles the price in one step; each side's limit stays private. |
| **Useful things sit idle** | The average US household holds roughly $3,000–4,000 of unused items that could be resold ([eBay 2026 Recommerce Report, via La Voce di New York](https://lavocedinewyork.com/en/lifestyles/2026/10/09/secondhand-shopping-takes-off-as-americans-look-to-save-money/)). | Selling takes one sentence, so a $15 item is worth selling. Standing requests wait for the next seller. |
| **Move-out waste** | The US generated 12.1 million tons of furniture and furnishings waste in 2018, and 80.1% went to landfill ([EPA](https://19january2025snapshot.epa.gov/facts-and-figures-about-materials-waste-and-recycling/durable-goods-product-specific-data)). | June move-out becomes a market: the mini fridge and the desk go to next year's student down the street. |
| **Students pay a lot for books and supplies** | Public four-year students are budgeted about $1,290 a year for books and supplies ([College Board figures via BestColleges](https://bestcolleges.com/research/average-cost-of-college-textbooks-statistics/)). | Textbooks and calculators circulate on campus every quarter at student prices. |

## One exchange, side by side

**A $20 graphing calculator (TI-84), buyer's budget $18, seller's minimum $15.**

| | Seller receives | Buyer pays | Steps for the seller |
|---|---:|---:|---|
| Poshmark (20%) | $16.00 on a $20 sale | $20 + shipping | Photos, listing form, offers, shipping label |
| Mercari (10% + 2.9% + $0.30) | about $17.12 on a $20 sale | $20 + shipping | Photos, listing form, offers, shipping |
| eBay (about 13.25% + $0.30) | about $17.05 on a $20 sale | $20 + shipping | Photos, listing form, offers, shipping |
| **PairUp** | **$18.00** | **$18.00** | "Sell my TI-84 for $20, I'll take anything above $15." Then one yes. |

Fee rates from the sources in the table above; resale-site rows assume the item sells
at its $20 ask **(model)**. On PairUp the seller keeps more and the buyer pays less on
the same day, because the deal happens between two people on one campus.

**A lunch run, HUB to McCarty Hall.** The requester offers up to $5; a student
already walking that way takes it for $4. The meal costs its counter price, and the
whole $4 goes to the student who carried it.

## Market size

| Layer | Size | Source |
|---|---|---|
| US secondhand apparel alone | Grew 14% in 2024; projected $74 billion by 2029. 58% of US consumers bought secondhand apparel in 2024. | [ThredUp 2025 Resale Report via Chain Store Age](https://chainstoreage.com/thredup-us-secondhand-apparel-sales-reach-74b-2029), [Retail Dive](https://www.retaildive.com/news/thredup-2025-resale-report-tariffs-fast-fashion/743095/) |
| Idle goods in homes | About $3,000–4,000 of resellable items per household | [eBay 2026 Recommerce Report](https://lavocedinewyork.com/en/lifestyles/2026/10/09/secondhand-shopping-takes-off-as-americans-look-to-save-money/) |
| People earning on their own | 72.9 million US independent workers in 2025, including 37.4 million occasional earners | [MBO Partners 2025](https://www.mbopartners.com/blog/news/the-rise-of-the-independent-workforce-key-insights-from-the-2025-state-of-independence-report) |
| Young adults already doing gig work | 30% of US adults aged 18–29 have earned money through an online gig platform | [Pew Research Center](https://www.pewresearch.org/internet/2021/12/08/the-state-of-gig-work-in-2021/) |
| Voice reach | Over 600 million Alexa devices sold; 97% of them can run Alexa+ | [TechCrunch, CES 2026](https://techcrunch.com/2026/01/12/amazon-says-97-of-its-devices-can-support-alexa) |
| US college students | Fall 2025 enrollment rose 1.0%; about 19 million students | [National Student Clearinghouse](https://www.studentclearinghouse.org/news/?p=73935) |
| Launch campus | 52,316 students at UW Seattle in autumn 2025 | [UW News](https://www.washington.edu/news/2025/10/30/washington-residents-make-up-nearly-two-thirds-of-incoming-class-as-enrollment-increases-across-all-three-uw-campuses/) |

The apparel figure covers one category. PairUp serves every category of thing plus
errands, hourly help and event staffing, which today live in separate apps.

### UW Seattle: what one campus is worth (model)

Inputs, stated so anyone can change them:

- 52,316 students (UW autumn 2025 census).
- 10% use PairUp in a quarter: 5,200 people.
- Each makes 2 exchanges a month, average $15 (the same range as a used textbook, a
  calculator, a lamp or two lunch runs).

Result: about **10,500 exchanges and $157,000 a month** changing hands on one campus,
roughly **$1.9 million a year**. At the resale-site commission rates above (13–20%),
that is **$250,000–$375,000 a year** that stays with UW students. The same inputs
across about 19 million US college students give **about $680 million a year** of
exchange.

## Make personal business great

Most people already have a small business in them: a desk to sell in June, a bike
pump and twenty minutes, a van on Saturdays. Today each one needs its own app, a
listing, a profile and a fee.

On PairUp:

- **Opening a business is one sentence.** "I do lunch runs from the HUB on weekdays,
  $4." The offer stands and is paired whenever a request fits.
- **The price is the seller's.** A public ask, a private minimum, and automatic
  acceptance of any offer at or above it.
- **The earnings are the seller's.** The agreed price is paid in full at the hand-off.
- **Reputation compounds.** Ratings build a track record, and the ranking learns to
  put reliable people first.
- **Customers come back.** PairUp learns routines (the weekday lunch run) and offers
  them again, so a regular helper gets regular work.
- **Organizations hire in one request.** A club staffs a whole Saturday event with
  three roles and no overlapping bookings.

## C2C in the future

Commerce is moving from apps people browse to agents that act for them. Two agents
can now meet in seconds, and they need three things to make deals people can trust:

1. **A shared place to meet.** PairUp is an MCP server: Alexa+, a Strands agent on
   Bedrock AgentCore, or any MCP client connects through OAuth 2.1 and uses the same
   tools, Agent Skill, server card and llms.txt.
2. **A price rule nobody can talk around.** Agents never bargain. Prices come from
   one deterministic rule in an open-source library with shared test vectors, so
   every host settles the same deal the same way.
3. **A human yes.** Agents find, explain and prepare; people confirm. Private limits
   stay on the server.

That makes PairUp the C2C layer for agent commerce: every person can be a buyer and a
seller at once, through whatever assistant they already talk to.

### Roadmap

| Stage | Market | Reach |
|---|---|---|
| Now | UW Seattle campus and nearby neighborhoods | 52,316 students |
| Next | Seattle-area campuses and neighborhoods | Seattle metro |
| Then | US campuses, one at a time, with campus Hub points for hand-offs | About 19 million students |
| Beyond | Any neighborhood, any MCP-connected agent | Every Alexa household and personal agent |

Campuses are a strong first market: dense, walkable, with needs that repeat every
quarter, and a move-in and move-out cycle that refills supply each year.

## Fit with Amazon

- **Alexa+** becomes the voice for local buying and selling as well as shopping.
- **Amazon Hub Lockers and Counters** become safe, public hand-off points.
- **amazon.com** catches every need nobody nearby can meet: PairUp shows the new
  price with a link.
- **AWS** runs it: Bedrock, AgentCore, CloudFront, EC2 Graviton and CloudWatch.

## What the research says

Eighteen papers back the design; [LITERATURE.md](LITERATURE.md) gives each one with
what it means for PairUp. The short version:

- Searching and haggling cost enough to kill small trades (Stigler 1961; Coase 1937);
  peer markets win by making it easy to find each other and trade safely (Einav,
  Farronato and Levin 2016; Roth 2008).
- Bargaining leaks private information and loses deals both sides wanted (Chatterjee
  and Samuelson 1983; Backus, Blake and Tadelis 2019, on millions of eBay Best Offer
  negotiations).
- AI negotiators are easy to sway: an agent acting desperate gains about 20%
  (Bianchi et al., ICML 2024), and agents in simulated markets favor the first offer
  they see (Microsoft's Magentic Marketplace, 2025). A fixed price rule and
  server-side ranking avoid both.
- People who set their own hours value that flexibility at more than twice the
  surplus of fixed work (Chen et al. 2019); peer markets create large gains for
  buyers (Cohen et al. 2016: about $1.60 of value per dollar spent on UberX).
- Reuse avoids environmental impact, most per item for furniture (Castellani, Sala
  and Mirabella 2015).

## How we measure impact

The UW pilot ([USER_VALIDATION.md](../docs/USER_VALIDATION.md)) and the live service track:

| Metric | Meaning |
|---|---|
| Time from request to proposed deal | Faster |
| Price paid against the typical range and the new price on Amazon | Cheaper |
| Share of the price kept by the seller or helper | Personal business |
| Repeat providers and returning routines | Personal business |
| Requests paired from either side, across categories | C2C reach |
| Unaided task success and correct understanding of cost and time | Trust and design |
| Reports per thousand deals | Safety |

Results go into this page as they come in.
