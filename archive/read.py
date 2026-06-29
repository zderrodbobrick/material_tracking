import logging
import time
logging.basicConfig(level=logging.INFO)

from sllurp.llrp import LLRPReaderConfig, LLRPReaderClient, LLRP_DEFAULT_PORT

READER_IP = "169.254.135.83"

RSSI_THRESHOLD = -55  # only tags this close will be reported

def tag_callback(reader, tag_reports):
    for tag in tag_reports:
        epc = tag['EPC'].hex()
        rssi = tag['PeakRSSI']
        antenna = tag['AntennaID']
        
        if rssi < RSSI_THRESHOLD:
            continue  # ignore distant tags
            
        print(f"Tag: {epc} | RSSI: {rssi} | Antenna: {antenna}", flush=True)

config = LLRPReaderConfig({
    'tx_power': 91,
    'report_every_n_tags': 1,
    'start_inventory': True,
    'reset_on_connect': True,
    'mode_identifier': 1,
    'impinj_search_mode': 2,  # dual target - reads same tag repeatedly
    'tag_content_selector': {
        'EnableAntennaID': True,
        'EnablePeakRSSI': True,
        'EnableLastSeenTimestamp': True,
        'EnableTagSeenCount': True,
    }
})

reader = LLRPReaderClient(READER_IP, LLRP_DEFAULT_PORT, config)
reader.add_tag_report_callback(tag_callback)

print("Connecting to reader...")
reader.connect()
print("Connected! Waiting for tags... (Ctrl+C to stop)")

try:
    while True:
        time.sleep(0.1)
except (KeyboardInterrupt, SystemExit):
    print("Stopping...")
    reader.disconnect()