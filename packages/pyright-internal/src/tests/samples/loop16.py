# This sample tests a complex function that contains a loop and a long
# chain of if/elif statements.

from random import randint


def get_ipv4():
    try:
        while 1:
            ip1, ip2, ip3, ip4 = (
                randint(1, 255),
                randint(1, 255),
                randint(1, 255),
                randint(1, 255),
            )

            if ip1 == 127:
                continue
            elif ip1 == 0:
                continue
            elif ip1 == 1:
                continue
            elif ip1 == 2:
                continue
            elif ip1 == 3:
                continue
            elif ip1 == 4:
                continue
            elif ip1 == 5:
                continue
            elif ip1 == 6:
                continue
            elif ip1 == 7:
                continue
            elif ip1 == 8:
                continue
            elif ip1 == 9:
                continue
            elif ip1 == 11:
                continue
            elif ip1 == 12:
                continue
            elif ip1 == 17:
                continue
            elif ip1 == 19:
                continue
            elif ip1 == 15:
                continue
            elif ip1 == 56:
                continue
            elif ip1 == 10:
                continue
            elif ip1 == 25:
                continue
            elif ip1 == 49:
                continue
            elif ip1 == 50:
                continue
            elif ip1 == 73:
                continue
            elif ip1 == 137:
                continue
            elif ip1 == 11:
                continue
            elif ip1 == 21:
                continue
            elif ip1 == 22:
                continue
            elif ip1 == 26:
                continue
            elif ip1 == 28:
                continue
            elif ip1 == 29:
                continue
            elif ip1 == 30:
                continue
            elif ip1 == 33:
                continue
            elif ip1 == 55:
                continue
            elif ip1 == 214:
                continue
            elif ip1 == 215:
                continue
            elif ip1 == 192 and ip2 == 168:
                continue
            elif ip1 == 146 and ip2 == 17:
                continue
            elif ip1 == 146 and ip2 == 80:
                continue
            elif ip1 == 146 and ip2 == 98:
                continue
            elif ip1 == 146 and ip2 == 154:
                continue
            elif ip1 == 147 and ip2 == 159:
                continue
            elif ip1 == 148 and ip2 == 114:
                continue
            elif ip1 == 150 and ip2 == 125:
                continue
            elif ip1 == 150 and ip2 == 133:
                continue
            elif ip1 == 150 and ip2 == 144:
                continue
            elif ip1 == 150 and ip2 == 149:
                continue
            elif ip1 == 150 and ip2 == 157:
                continue
            elif ip1 == 150 and ip2 == 184:
                continue
            elif ip1 == 150 and ip2 == 190:
                continue
            elif ip1 == 150 and ip2 == 196:
                continue
            elif ip1 == 152 and ip2 == 82:
                continue
            elif ip1 == 152 and ip2 == 229:
                continue
            elif ip1 == 157 and ip2 == 202:
                continue
            elif ip1 == 157 and ip2 == 217:
                continue
            elif ip1 == 161 and ip2 == 124:
                continue
            elif ip1 == 162 and ip2 == 32:
                continue
            elif ip1 == 155 and ip2 == 96:
                continue
            elif ip1 == 155 and ip2 == 149:
                continue
            elif ip1 == 155 and ip2 == 155:
                continue
            elif ip1 == 155 and ip2 == 178:
                continue
            elif ip1 == 164 and ip2 == 158:
                continue
            elif ip1 == 156 and ip2 == 9:
                continue
            elif ip1 == 167 and ip2 == 44:
                continue
            elif ip1 == 168 and ip2 == 68:
                continue
            elif ip1 == 168 and ip2 == 85:
                continue
            elif ip1 == 168 and ip2 == 102:
                continue
            elif ip1 == 203 and ip2 == 59:
                continue
            elif ip1 == 204 and ip2 == 34:
                continue
            elif ip1 == 207 and ip2 == 30:
                continue
            elif ip1 == 117 and ip2 == 55:
                continue
            elif ip1 == 117 and ip2 == 56:
                continue
            elif ip1 == 80 and ip2 == 235:
                continue
            elif ip1 == 207 and ip2 == 120:
                continue
            elif ip1 == 209 and ip2 == 35:
                continue
            elif ip1 == 64 and ip2 == 70:
                continue
            elif ip1 == 172 and ip2 >= 16 and ip2 < 32:
                continue
            elif ip1 == 100 and ip2 >= 64 and ip2 < 127:
                continue
            elif ip1 == 169 and ip2 > 254:
                continue
            elif ip1 == 198 and ip2 >= 18 and ip2 < 20:
                continue
            elif ip1 == 64 and ip2 >= 69 and ip2 < 227:
                continue
            elif ip1 == 128 and ip2 >= 35 and ip2 < 237:
                continue
            elif ip1 == 129 and ip2 >= 22 and ip2 < 255:
                continue
            elif ip1 == 130 and ip2 >= 40 and ip2 < 168:
                continue
            elif ip1 == 131 and ip2 >= 3 and ip2 < 251:
                continue
            elif ip1 == 132 and ip2 >= 3 and ip2 < 251:
                continue
            elif ip1 == 134 and ip2 >= 5 and ip2 < 235:
                continue
            elif ip1 == 136 and ip2 >= 177 and ip2 < 223:
                continue
            elif ip1 == 138 and ip2 >= 13 and ip2 < 194:
                continue
            elif ip1 == 139 and ip2 >= 31 and ip2 < 143:
                continue
            elif ip1 == 140 and ip2 >= 1 and ip2 < 203:
                continue
            elif ip1 == 143 and ip2 >= 45 and ip2 < 233:
                continue
            elif ip1 == 144 and ip2 >= 99 and ip2 < 253:
                continue
            elif ip1 == 146 and ip2 >= 165 and ip2 < 166:
                continue
            elif ip1 == 147 and ip2 >= 35 and ip2 < 43:
                continue
            elif ip1 == 147 and ip2 >= 103 and ip2 < 105:
                continue
            elif ip1 == 147 and ip2 >= 168 and ip2 < 170:
                continue
            elif ip1 == 147 and ip2 >= 198 and ip2 < 200:
                continue
            elif ip1 == 147 and ip2 >= 238 and ip2 < 255:
                continue
            elif ip1 == 150 and ip2 >= 113 and ip2 < 115:
                continue
            elif ip1 == 152 and ip2 >= 151 and ip2 < 155:
                continue
            elif ip1 == 153 and ip2 >= 21 and ip2 < 32:
                continue
            elif ip1 == 155 and ip2 >= 5 and ip2 < 10:
                continue
            elif ip1 == 155 and ip2 >= 74 and ip2 < 89:
                continue
            elif ip1 == 155 and ip2 >= 213 and ip2 < 222:
                continue
            elif ip1 == 157 and ip2 >= 150 and ip2 < 154:
                continue
            elif ip1 == 158 and ip2 >= 1 and ip2 < 21:
                continue
            elif ip1 == 158 and ip2 >= 235 and ip2 < 247:
                continue
            elif ip1 == 159 and ip2 >= 120 and ip2 < 121:
                continue
            elif ip1 == 160 and ip2 >= 132 and ip2 < 151:
                continue
            elif ip1 == 64 and ip2 >= 224 and ip2 < 227:
                continue
            elif ip1 == 162 and ip2 >= 45 and ip2 < 47:
                continue
            elif ip1 == 163 and ip2 >= 205 and ip2 < 207:
                continue
            elif ip1 == 164 and ip2 >= 45 and ip2 < 50:
                continue
            elif ip1 == 164 and ip2 >= 217 and ip2 < 233:
                continue
            elif ip1 == 207 and ip2 >= 60 and ip2 < 62:
                continue
            elif ip1 == 104 and ip2 >= 16 and ip2 < 31:
                continue
            elif ip1 == 193 and ip2 == 164:
                continue
            elif ip1 == 120 and ip2 >= 103 and ip2 < 108:
                continue
            elif ip1 == 188 and ip2 == 68:
                continue
            elif ip1 == 78 and ip2 == 46:
                continue
            elif ip1 >= 224:
                continue
            elif (ip1 == 178 and ip2 == 128) or (ip1 == 123 and ip2 == 59):
                continue
            elif (
                (ip1 == 124 and ip2 == 244)
                or (ip1 == 178 and ip2 == 254)
                or (ip1 == 185 and ip2 == 168)
                or (ip1 == 178 and ip2 == 79)
            ):
                continue
            elif ip1 == 192 and ip2 == 88 and ip3 == 99:
                continue
            elif ip1 == 240:
                continue
            elif ip1 == 255 and ip2 == 255 and ip3 == 255 and ip4 == 255:
                continue
            elif ip1 == 126:
                continue
            elif ip1 == 13 and ip2 == 107 and ip3 == 6 and ip4 == 152:
                continue
            # elif ip1 == 13 and ip2 == 107 and ip3 == 18 and ip4 == 10:
            #     continue
            # elif ip1 == 13 and ip2 == 107 and ip3 == 128 and ip4 == 0:
            #     continue
            # elif ip1 == 23 and ip2 == 103 and ip3 == 160 and ip4 == 0:
            #     continue
            # elif ip1 == 40 and ip2 == 96 and ip3 == 0 and ip4 == 0:
            #     continue
            # elif ip1 == 40 and ip2 == 104 and ip3 == 0 and ip4 == 0:
            #     continue
            # elif ip1 == 52 and ip2 == 96 and ip3 == 0 and ip4 == 0:
            #     continue
            # elif ip1 == 131 and ip2 == 253 and ip3 == 33 and ip4 == 215:
            #     continue
            # elif ip1 == 132 and ip2 == 245 and ip3 == 0 and ip4 == 0:
            #     continue
            # elif ip1 == 150 and ip2 == 171 and ip3 == 32 and ip4 == 0:
            #     continue
            # elif ip1 == 204 and ip2 == 79 and ip3 == 197 and ip4 == 215:
            #     continue
            # elif ip1 == 208 and ip2 == 71 and (ip3 > 120 and ip3 < 127):
            #     continue
            # elif ip1 == 117 and ip2 == 102 and (ip3 > 128 and ip3 < 159):
            #     continue
            # elif ip1 == 203 and ip2 == 171 and (ip3 > 192 and ip3 < 207):
            #     continue
            # elif ip1 == 59 and (ip3 > 192 and ip3 < 255):
            #     continue
            # elif ip1 == 163 and ip2 == 233:
            #     continue
            # elif ip1 == 62 and ip2 <= 30:
            #     continue  # honey pots
            # elif ip1 == 207 and ip2 >= 31 and ip3 <= 120:
            #     continue  # fbi honey pots
            # elif ip1 == 65 and ip2 >= 224 and ip3 <= 226:
            #     continue  # more honey pots
            # elif ip1 == 195 and ip2 == 10:
            #     continue  # another honeypot
            # elif ip1 == 216 and (ip2 == 25 or ip2 == 94):
            #     continue
            # elif ip1 == 212 and ip2 == 56:
            #     continue

            ip = f"{str(ip1)}.{str(ip2)}.{str(ip3)}.{str(ip4)}"
            return ip
    except:
        pass
