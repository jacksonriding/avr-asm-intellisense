ldi r16, 0
.equ LIMIT, 3
loop:
subi r16, LIMIT
brne loop
ret
