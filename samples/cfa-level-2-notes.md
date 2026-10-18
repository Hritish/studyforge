# CFA Level II — Study Notes (sample)

These are sample revision notes for trying StudyForge. Upload this file (or paste it) on the "New set" page.

## Equity Valuation

Gordon growth model: V0 = D1 / (r − g), where D1 is next year's dividend, r is the required return on equity and g is the constant dividend growth rate (g < r).
Sustainable growth rate: g = b × ROE, where b is the earnings retention rate (1 − dividend payout ratio).
Free cash flow to the firm (FCFF): cash flow available to all capital providers after operating expenses, taxes and investment in working and fixed capital. FCFF = NI + NCC + Int(1 − t) − FCInv − WCInv.
Free cash flow to equity (FCFE): cash flow available to common shareholders after all obligations to debt holders. FCFE = FCFF − Int(1 − t) + net borrowing.
FCFF discount rate: FCFF is discounted at the WACC to value the firm; FCFE is discounted at the required return on equity to value equity directly.
Residual income: net income minus a charge for the cost of equity capital; RI_t = E_t − r × B_(t−1).
Residual income model value: V0 = B0 + sum of PV of expected future residual income. Most useful when the firm pays no dividends or FCFE is negative.
Justified leading P/E: P0/E1 = (1 − b) / (r − g), the P/E implied by the Gordon growth model.
Clean surplus relation: ending book value = beginning book value + net income − dividends. Residual income models assume it holds.
Persistence factor (ω): a value between 0 and 1 measuring how long residual income persists; ω = 1 means RI continues indefinitely, ω = 0 means RI drops to zero after the forecast horizon.

## Fixed Income

Spot rate: the yield on a zero-coupon bond for a given maturity; used to discount each cash flow at its own rate.
Forward rate: an interest rate for a loan starting in the future implied by today's spot rates; (1 + S2)^2 = (1 + S1)(1 + f(1,1)).
Z-spread: the constant spread added to every spot rate on the benchmark curve so the discounted cash flows equal the bond's price.
Option-adjusted spread (OAS): the Z-spread minus the value of the embedded option expressed as a spread; OAS = Z-spread − option cost.
Callable bond value: value of straight bond − value of the call option. The issuer holds the call option.
Putable bond value: value of straight bond + value of the put option. The investor holds the put option.
Effective duration: sensitivity of a bond's price to a parallel shift in the benchmark curve, used for bonds with embedded options; ED = (PV− − PV+) / (2 × ΔCurve × PV0).
Credit valuation adjustment (CVA): the present value of expected loss on a bond over its life; fair value of a risky bond = value of risk-free bond − CVA.
Swap spread: the difference between the swap rate and the Treasury yield of the same maturity.

## Derivatives

Forward contract value at initiation: zero; the forward price is set so neither party pays at inception.
No-arbitrage forward price: F0(T) = S0 × (1 + r)^T for an asset with no income or costs.
Interest rate swap: equivalent to a series of forward rate agreements (FRAs); the swap rate is the fixed rate that sets the swap value to zero at initiation.
Put–call parity: S0 + p0 = c0 + X / (1 + r)^T. A fiduciary call equals a protective put.
Delta: the change in an option's price for a small change in the underlying price; call delta is between 0 and 1, put delta between −1 and 0.
Binomial model hedge ratio: h = (c+ − c−) / (S+ − S−), the number of shares to hold per option sold to create a riskless portfolio.
Black–Scholes–Merton assumption: the underlying follows geometric Brownian motion with constant volatility and continuously compounded risk-free rate.

## Ethical and Professional Standards

Standard I(A) Knowledge of the Law: members must comply with the stricter of applicable law or the CFA Institute Code and Standards.
Standard II(A) Material Nonpublic Information: members who possess material nonpublic information must not act or cause others to act on it.
Mosaic theory: an analyst may reach a conclusion from public information and nonmaterial nonpublic information without violating Standard II(A).
Standard III(A) Loyalty, Prudence, and Care: members owe a duty of loyalty to clients and must place clients' interests before their employer's or their own.
Standard VI(B) Priority of Transactions: client and employer transactions take priority over personal transactions.
Standard IV(C) Responsibilities of Supervisors: supervisors must make reasonable efforts to ensure that anyone under their supervision complies with laws and the Code and Standards.

## Quantitative Methods

Multicollinearity: two or more independent variables in a multiple regression are highly correlated; inflates standard errors so t-tests understate significance even though the F-test is significant.
Heteroskedasticity: the variance of regression residuals is not constant; conditional heteroskedasticity is detected with the Breusch–Pagan test and corrected with robust (White) standard errors.
Adjusted R²: R² adjusted for the number of independent variables; it does not automatically increase when variables are added.
