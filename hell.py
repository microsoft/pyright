# Import the required libraries
from twilio.rest import Client

# Your Twilio account SID and Auth Token
account_sid = 'your_twilio_account_sid'
auth_token = 'your_twilio_auth_token'

# Create a Twilio client
client = Client(account_sid, auth_token)

# The list of business dealer numbers
dealers = ['+1XXXXXXXXXX', '+1XXXXXXXXXX', '+1XXXXXXXXXX']

# The message to be sent to the dealers
message = 'Hi, this is a message from your business owner.'

# Loop through the list of dealers and send the message
for dealer in dealers:
    message = client.messages.create(
        to=dealer,
        from_='whatsapp:+14155238886',
        body=message
    )

print(f'Message sent to {len(dealers)} dealers.')
