# Predict60 TODO

## Before re-enabling Oil

- [ ] Revoke the OilPriceAPI key that was committed to Git history.
- [ ] Generate a replacement key and store it only in the protected VPS
  environment as `OILPRICE_API_KEY`.
- [ ] Remove the obsolete local `oilpriceapi.key` file after revocation.
- [ ] Verify the replacement through the server-side Oil diagnostic endpoint;
  never expose the key to browser code or logs.
- [ ] Confirm the provider subscription, data rights, freshness, instrument
  mappings, and settlement requirements before making Oil tradable.
