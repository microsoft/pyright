import re
from collections import Counter

def read_log_file(file_path):
    with open(file_path, 'r') as file:
        return file.readlines()

def count_unique_ips(log_lines):
    unique_ips = set()
    for line in log_lines:
        # Use regex to extract the IP address
        match = re.match(r'(\d+\.\d+\.\d+\.\d+)', line)
        if match:
            ip = match.group(1)
            unique_ips.add(ip)
    return len(unique_ips)

def top_three_ips(log_lines):
    # Initialize a Counter to keep track of IP occurrences
    ip_counter = Counter()
    for line in log_lines:
        # Use regex to extract the IP address
        match = re.match(r'(\d+\.\d+\.\d+\.\d+)', line)
        if match:
            ip = match.group(1)
            ip_counter[ip] += 1
    # Get the top 3 most frequent IP addresses
    top_three = ip_counter.most_common(3)
    return top_three

def requests_per_endpoint(log_lines):
    # Dictionary to store endpoint request counts
    endpoint_counter = {}
    for line in log_lines:
        # Use regex to extract the endpoint
        match = re.search(r'\"(?:GET|POST|PUT|DELETE|HEAD|OPTIONS) (.+?) HTTP/\d\.\d\"', line)
        if match:
            endpoint = match.group(1)
            # Use the dict.get() method to update the count of the endpoint
            endpoint_counter[endpoint] = endpoint_counter.get(endpoint, 0) + 1
    return endpoint_counter

def main():
    log_lines = read_log_file('server.log')

    unique_ip_count = count_unique_ips(log_lines)
    print(f"Number of unique IP addresses: {unique_ip_count}")

    top_ips = top_three_ips(log_lines)
    print("Top 3 most frequent IP addresses:")
    for ip, count in top_ips:
        print(f"{ip}: {count} times")

    endpoint_counts = requests_per_endpoint(log_lines)
    print("Number of requests per endpoint:")
    for endpoint, count in endpoint_counts.items():
        print(f"{endpoint}: {count} times")

if __name__ == "__main__":
    main()
