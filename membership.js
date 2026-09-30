(() => {
  const config = window.WMIH_MEMBERSHIP || {};
  const status = document.getElementById("membership-status");
  if (config.signupEnabled !== true) return;
  const plans = {
    annual: config.annualCheckoutUrl,
    monthly: config.monthlyCheckoutUrl
  };

  function verifiedCheckoutUrl(value) {
    if (typeof value !== "string" || !value.trim()) return null;
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.hostname !== "buy.stripe.com" ||
          url.username || url.password || url.port || url.pathname === "/") return null;
      return url.href;
    } catch {
      return null;
    }
  }

  let available = 0;
  document.querySelectorAll("[data-membership-plan]").forEach(button => {
    const url = verifiedCheckoutUrl(plans[button.dataset.membershipPlan]);
    if (!url) return;
    button.disabled = false;
    available += 1;
    button.addEventListener("click", () => window.location.assign(url));
  });
  if (!status) return;
  if (available === 2) {
    status.textContent = "Secure checkout through Stripe. Review your billing schedule before confirming payment.";
  } else if (available === 1) {
    status.textContent = "One membership option is temporarily unavailable. Available memberships use secure Stripe checkout.";
  }
})();
