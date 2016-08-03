#Status Page Controller
Automates the setting of statuspage.io component statuses based on New Relic alerts.

##Basic Design
![statuspagecontrolerdesign](https://cloud.githubusercontent.com/assets/3926730/17302336/c955254c-57e9-11e6-8ed9-af3062e0cd07.png)

##Sync vs Push
Both New Relic and StatusPage.io have ways to automate via push.  New Relic alerts can post to a webhook, or send an email, and StatusPage.io components can be updated with a unique email.  The problem with this method is that if a message is ever lost, then the state between New Relic and StatusPage.io will get out of sync.

By synchronizing both systems with their APIs, the states between the two will always be kept in sync, even if an alert message is never received.  It also updates states faster than email.  As soon as a violation is created it will be picked up on the next sync.  If Status Controller ever goes down, the next time it is started it will sync the statuses to their current state.
