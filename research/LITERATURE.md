# What the research says

Peer-reviewed and working papers behind PairUp's design and its impact. Each entry
gives the finding in our own words and what it means for PairUp. Grouped by the
claim it supports.

## 1. Faster and cheaper: the cost of finding each other

**Stigler, G. J. (1961). The Economics of Information.** *Journal of Political
Economy*, 69(3), 213–225.
Prices for the same good differ across sellers because searching is costly, and
buyers stop searching once the next search is expected to cost more than it saves.
→ *PairUp:* one sentence searches every standing offer on campus, so the cost of
finding the best nearby seller drops close to zero, and with it the price spread a
buyer has to accept.

**Coase, R. H. (1937). The Nature of the Firm.** *Economica*, 4(16), 386–405.
Using a market has costs of its own: finding a partner, negotiating, writing and
enforcing the deal. Trades whose value is smaller than those costs never happen.
→ *PairUp:* the $4 lunch run and the $15 lamp are exactly the trades these costs
used to kill. Voice input, automatic pairing and a fixed price rule cut each cost
to one sentence and one yes.

**Einav, L., Farronato, C., & Levin, J. (2016). Peer-to-Peer Markets.** *Annual
Review of Economics*, 8, 615–635. [NBER w21496](https://nber.org/papers/w21496)
The central job of a peer-to-peer platform is making it easy for buyers to find
sellers and trade conveniently and safely; the tools are search and matching,
pricing and reputation. These markets let small and flexible suppliers enter.
→ *PairUp:* those three tools are the product: semantic matching from either side,
the pairing-core price rule, and ratings with reports.

**Roth, A. E. (2008). What Have We Learned from Market Design?** *The Economic
Journal*, 118(527), 285–310.
Markets work when they are thick (enough participants), uncongested (enough time
to make and consider offers) and safe (honest participation is a good strategy).
→ *PairUp:* standing requests make the market thick over time; one-step pricing
removes congestion; private limits and one offer below the ask per buyer make
honest limits safe to state.

## 2. Pricing without haggling

**Myerson, R. B., & Satterthwaite, M. A. (1983). Efficient Mechanisms for Bilateral
Trading.** *Journal of Economic Theory*, 29(2), 265–281.
When buyer and seller each hold a private value, no trading rule can be fully
efficient, voluntary, budget-balanced and incentive-proof at once. Every real rule
picks its trade-offs.
→ *PairUp:* we choose a simple, published rule (a public ask with automatic
best-offer acceptance) and state its trade-offs openly in
[pairing-core](https://github.com/rairurairu/pairing-core).

**Chatterjee, K., & Samuelson, W. (1983). Bargaining under Incomplete
Information.** *Operations Research*, 31(5), 835–851.
In sealed-offer bargaining, both sides shade their offers strategically, and some
deals both would gain from fail to happen.
→ *PairUp:* the seller's minimum never sets the price and a buyer gets one offer
below the ask, which removes the reason to shade or probe.

**Backus, M., Blake, T., & Tadelis, S. (2019). On the Empirical Content of
Cheap-Talk Signaling: An Application to Bargaining.** *Journal of Political
Economy*, 127(4), 1599–1628.
Across millions of eBay Best Offer negotiations, sellers who listed at round
numbers received offers 8–12% lower and sold 15–25% more often: the listing price
itself leaks how eager a seller is.
→ *PairUp:* back-and-forth bargaining leaks information and costs money. A seller's
minimum stays on the server and never moves the price.

## 3. Agents negotiating for people need a fixed rule

**Bianchi, F., et al. (2024). How Well Can LLMs Negotiate? NegotiationArena
Platform and Analysis.** *ICML 2024*, PMLR 235. [arXiv 2402.05863](https://arxiv.org/abs/2402.05863)
Language-model negotiators show anchoring and other irrational behavior, and an
agent that acts desperate can raise its payoff by about 20% against GPT-4.
→ *PairUp:* agents interpret and coordinate; the price comes from code. A clever
or pitiful message cannot move a deal.

**Bansal, G., et al. (2025). Magentic Marketplace: An Open-Source Environment for
Studying Agentic Markets.** Microsoft Research and Arizona State University.
[arXiv 2510.25779](https://arxiv.org/abs/2510.25779)
In simulated markets where AI agents shop for customers and sell for businesses,
frontier models approach the best outcome only when search is easy; quality drops as
markets grow, and every model shows a strong bias toward the first proposal it
receives.
→ *PairUp:* the server ranks every fitting offer (relevance, distance, urgency,
track record) before an agent sees it, so the best match wins over the fastest one.

**Hadfield, G. K., & Koh, A. (2025). An Economy of AI Agents.** Chapter for the
*NBER Handbook on the Economics of Transformative AI*.
[arXiv 2509.01063](https://arxiv.org/abs/2509.01063)
As AI agents trade with people and with each other, markets will need new
institutions to work well.
→ *PairUp:* an open protocol (MCP), a published price rule with shared test
vectors, and a required human yes are such institutions for C2C trade.

## 4. Trust between strangers

**Resnick, P., & Zeckhauser, R. (2002). Trust Among Strangers in Internet
Transactions: Empirical Analysis of eBay's Reputation System.** In *The Economics
of the Internet and E-Commerce* (Advances in Applied Microeconomics, Vol. 11),
127–157.
Feedback systems let strangers trade with confidence, even with imperfect ratings.
→ *PairUp:* ratings after every deal feed each person's track record, and the
ranking learns from it.

**Tadelis, S. (2016). Reputation and Feedback Systems in Online Platform Markets.**
*Annual Review of Economics*, 8, 321–340.
Reputation systems are central to trust on platforms, and their design matters:
ratings inflate and bad experiences go unreported unless the platform designs
against it.
→ *PairUp:* reports pause pairing until reviewed, and the price check warns buyers
about deals far below the usual price.

## 5. Personal business: flexible work and small sellers

**Chen, M. K., Rossi, P. E., Chevalier, J. A., & Oehlsen, E. (2019). The Value of
Flexible Work: Evidence from Uber Drivers.** *Journal of Political Economy*,
127(6), 2735–2794.
Drivers who choose their own hours earn more than twice the surplus they would get
in less flexible arrangements.
→ *PairUp:* providers state their own hours and price; PairUp books work only
inside those hours.

**Katz, L. F., & Krueger, A. B. (2019). The Rise and Nature of Alternative Work
Arrangements in the United States, 1995–2015.** *ILR Review*, 72(2), 382–416.
Alternative work arrangements (independent contracting, on-call and similar work)
grew as a share of US employment over two decades.
→ *PairUp:* a growing number of people already work for themselves in pieces;
PairUp gives that work one front door.

**Horton, J. J., & Zeckhauser, R. J. (2016). Owning, Using and Renting: Some Simple
Economics of the "Sharing Economy".** [NBER w22029](https://www.nber.org/papers/w22029)
Peer-to-peer markets let owners earn from goods they use only part of the time,
and lower costs of trading change what people choose to buy and own.
→ *PairUp:* the TI-84 in a drawer and the trolley used twice a year become income.

## 6. Consumers gain from peer markets

**Cohen, P., Hahn, R., Hall, J., Levitt, S., & Metcalfe, R. (2016). Using Big Data
to Estimate Consumer Surplus: The Case of Uber.** [NBER w22627](https://www.nber.org/papers/w22627)
UberX generated about $6.8 billion of consumer surplus in four US cities in 2015,
about $1.60 for every dollar spent.
→ *PairUp:* a peer market for small local needs creates value for buyers well
beyond what they pay.

**Farronato, C., & Fradkin, A. (2022). The Welfare Effects of Peer Entry: The Case
of Airbnb and the Accommodation Industry.** *American Economic Review*, 112(6).
[NBER w24361](https://www.nber.org/papers/w24361)
Peer supply adds the most value where and when regular supply is short, by
expanding capacity at peak demand.
→ *PairUp:* the exam-morning calculator and the move-out van are peak moments where
neighbors add supply that stores cannot.

## 7. Reuse is good for the planet

**Castellani, V., Sala, S., & Mirabella, N. (2015). Beyond the Throwaway Society: A
Life Cycle-Based Assessment of the Environmental Benefit of Reuse.** *Integrated
Environmental Assessment and Management*, 11(3), 373–382.
[doi:10.1002/ieam.1614](https://doi.org/10.1002/ieam.1614)
A life cycle method for second-hand goods finds that reuse avoids environmental
impact; furniture avoids the most per item and clothing the most in total.
→ *PairUp:* move-out furniture and the yearly textbook cycle are the reuse cases
with the largest gains per exchange.
