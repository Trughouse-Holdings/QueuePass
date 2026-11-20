QueuePass sample layouts (made 2026-11-19 for the EDIS demo)

Each .json file is a seating layout. In the Admin app: Venues > Add venue, fill in the name,
address and time zone, choose one of these files as the Layout file, then Create venue.
The venue's capacity is the file's seats. More layouts can be imported on the venue's page
(Layout file > Import layout file).

Small venues (quick to demo):
  black-box-studio.json         Black Box Studio        420 seats   theater in the round (center stage)
  community-fieldhouse.json     Community Fieldhouse  1,060 seats   basketball court, bleachers on four sides
  main-street-theater.json      Main Street Theater   1,201 seats   proscenium stage, orchestra + mezzanine
  riverside-amphitheater.json   Riverside Amphitheater 2,380 seats  outdoor stage, lower + upper bowl

KFC Yum! Center (the demo arena, wedge-shaped sections):
  yum-center-basketball.json     22,090 seats
  yum-center-center-stage.json   19,500 seats
  yum-center-end-stage.json      17,500 seats
  yum-center-wrestling.json      18,000 seats

Every file passes the QueuePass server's layout-file check. Each venue has 2 to 4 price levels
(for example Premium orchestra / Orchestra / Mezzanine), so an event there asks for one price
per level.
