&#32;Simple guide

1. Open a terminal and start the coding broker:

   ```
   systemctl --user start findspot-broker
   ```
2. Start the FindSpot team chat:

   ```
   /home/david/.local/share/findspot-team/bin/hermes-findspot lead chat
   ```
3. Type what you want the team to do. For a first run, try: “Show me the current FindSpot team status and suggest one small task.”
4. When finished, leave the chat with **Ctrl+D**. If you want to stop the broker too, run:

   ```
   systemctl --user stop findspot-broker
   ```


