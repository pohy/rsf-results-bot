[Login form](https://www.rallysimfans.hu/rbr/account2.php?centerbox=bejelentkezes2)
- Need to parse `token_account_login` and PHP session?

Login request
```
curl 'https://www.rallysimfans.hu/rbr/account2_login.php' \
  -H 'accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7' \
  -H 'accept-language: en-US,en;q=0.9' \
  -H 'cache-control: max-age=0' \
  -H 'content-type: application/x-www-form-urlencoded' \
  -b 'PHPSESSID=ac09dbbf2670eef2638a36cde6262105; rl_token=N2YzYmFlZTVmOWVmZDk1NmY0NGQ2NTcyOTY2NWYzMWZiNzI2ZTY0MTA5MWJjYzFhOTg1N2UwOTUxOGU4MmJkM3wyfDE3NzY3MjM0OTZ8OWU5OWI3OWQzMDY5NmZlODA0YmM1OWU2YjJmODQwYTJlZDM1YTEwYjA4MjQ1Y2JlYmYwZjg2YTRiMzYwNTIxYw%3D%3D' \
  -H 'origin: https://www.rallysimfans.hu' \
  --data-raw 'token_account_login=9ac90380dc632fc1ae0b6448b2647a7a8533f6f833061c9d8f5d88e089392e6e&login=login&token=&l_username=USER&l_pass=PASS'
```

Use session and parse comments from [stage results](https://www.rallysimfans.hu/rbr/rally_online.php?centerbox=rally_results_stres.php&rally_id=97248&cg=7&stage_no=1)
- Parse stage count and go through all stage results in a polite manner, not spamming the server
- Parametrize rally ID
