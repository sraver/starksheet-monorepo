import { Box, BoxProps } from "@mui/material";
import { useCallback, useContext, useEffect, useMemo } from "react";
import { useLoaderData, useNavigate } from "react-router-dom";
import { FunctionAbi, number } from "starknet";
import {
  CELL_BORDER_WIDTH,
  CELL_HEIGHT,
  CELL_WIDTH,
  GRID_SIZE,
  N_COL,
  N_ROW,
} from "../../config";
import { AbisContext } from "../../contexts/AbisContext";
import { AppStatusContext } from "../../contexts/AppStatusContext";
import { CellValuesContext } from "../../contexts/CellValuesContext";
import { OnsheetContext } from "../../contexts/OnsheetContext";
import { useSheetContract } from "../../hooks/useSheetContract";
import { chainProvider } from "../../provider";
import { Cell, CellData, CellRendered } from "../../types";
import { RC_BOUND } from "../../utils/constants";
import { bn2hex, hex2str, normalizeHexString } from "../../utils/hexUtils";
import ComputedCell from "../ComputedCell/ComputedCell";
import GreyCell from "../GreyCell/GreyCell";

const defaultRenderedCell = (tokenId: number): CellRendered => ({
  id: tokenId,
  owner: number.toBN(0),
  value: number.toBN(0),
});

const defaultCellData = (tokenId: number): CellData => ({
  contractAddress: RC_BOUND,
  selector: number.toBN(0),
  calldata: [],
});

export type SheetTableProps = {
  sx?: BoxProps["sx"];
};

const SheetTable = ({ sx }: SheetTableProps) => {
  const { values, setValues } = useContext(CellValuesContext);
  const { onsheet, setSelectedSheetAddress, appendSheet } =
    useContext(OnsheetContext);
  const { appStatus, updateSheetStatus } = useContext(AppStatusContext);
  const { getAbiForContract } = useContext(AbisContext);
  const { params } = useLoaderData() as { params: { address: string } };
  const { address } = params;
  const { contract } = useSheetContract(address);
  const navigate = useNavigate();

  const cells = useMemo(
    () => (address ? values[address] : []),
    [address, values]
  );

  const colNames = useMemo(
    () =>
      Array.from(Array(N_COL + 1).keys())
        .map((i) => (i + 9).toString(36).toUpperCase())
        .slice(1),
    []
  );

  const load = useCallback(
    (address: string) => {
      if (!address) {
        return;
      }

      if (!contract) {
        return;
      }

      const _selectedSheetAddress = address;
      // Copy current sheet address to prevent storing the async call results into the wrong key
      if (
        appStatus.sheets[_selectedSheetAddress] &&
        appStatus.sheets[_selectedSheetAddress].loading
      )
        return;

      updateSheetStatus(_selectedSheetAddress, {
        loading: true,
        error: false,
      });

      if (
        _selectedSheetAddress in values &&
        values[_selectedSheetAddress].length !== 0
      ) {
        updateSheetStatus(_selectedSheetAddress, { loading: false });
        return;
      }

      let error = false;
      let finalMessage = "";

      updateSheetStatus(_selectedSheetAddress, {
        message: "Rendering grid values",
      });
      const sheet = onsheet.sheets.find((sheet) => sheet.address === address);
      if (sheet === undefined) {
        Promise.all([
          chainProvider.callContract({
            contractAddress: address,
            entrypoint: "name",
          }),
          chainProvider.callContract({
            contractAddress: address,
            entrypoint: "symbol",
          }),
        ]).then((response) => {
          const [name, symbol] = response.map((result) =>
            hex2str(normalizeHexString(result.result[0]))
          );
          appendSheet({ name, symbol, address });
        });
      }
      let cells;
      if (sheet?.calldata) {
        cells = new Promise<Cell[]>((resolve) => resolve([]));
      } else {
        cells = contract.renderCells().then((renderedCells) => {
          updateSheetStatus(_selectedSheetAddress, {
            message: "Fetching cells metadata",
          });
          return Promise.all(
            (renderedCells as CellRendered[]).map(async (cell) => {
              const _cell = await contract.getCell(cell.id);
              return {
                ...cell,
                ..._cell,
                error: cell.error,
              };
            })
          );
        });
      }
      cells
        .then((cells: Cell[]) => {
          updateSheetStatus(_selectedSheetAddress, {
            message: "Finalizing sheet data",
          });
          const _cells = cells.reduce(
            (prev, cell) => ({
              ...prev,
              [parseInt(cell.id.toString())]: cell,
            }),
            {} as { [id: number]: Cell }
          );

          return Promise.all(
            Array.from(Array(GRID_SIZE).keys())
              .map(
                (i) =>
                  _cells[i] || {
                    ...defaultRenderedCell(i),
                    ...defaultCellData(i),
                  }
              )
              .map(async (cell, _, array) => {
                const resolvedContractAddress = cell.contractAddress.lt(
                  RC_BOUND
                )
                  ? array[cell.contractAddress.toNumber()].value
                  : cell.contractAddress;
                const abi = await getAbiForContract(
                  bn2hex(resolvedContractAddress)
                );
                return {
                  ...cell,
                  abi: abi[bn2hex(cell.selector)] as FunctionAbi,
                };
              })
          );
        })
        .then((cells) => {
          setValues((prevValues) => ({
            ...prevValues,
            [_selectedSheetAddress]: cells,
          }));
        })
        .catch((error) => {
          error = true;
          finalMessage = `Error: Starksheet cannot render sheet at address ${address}
              <br />
              <br />
              Double check address or create a new sheet by clicking on the + button`;

          navigate(`/`);
        })
        .finally(() => {
          updateSheetStatus(_selectedSheetAddress, {
            loading: false,
            error,
            message: finalMessage,
          });
        });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [address, contract, getAbiForContract, setValues, values]
  );

  useEffect(() => {
    if (address) {
      setSelectedSheetAddress(address);
      load(address);
    }
  }, [address, load, setSelectedSheetAddress]);

  return (
    <Box sx={{ position: "relative", background: "#e2e2e2", ...sx }}>
      <Box sx={{ display: "flex", position: "sticky", top: 0, zIndex: 1 }}>
        <GreyCell
          variant="2"
          sx={{
            width: `${CELL_WIDTH}px`,
            minWidth: `${CELL_WIDTH}px`,
            maxWidth: `${CELL_WIDTH}px`,
            position: "sticky",
            left: 0,
            top: 0,
            zIndex: 2,
          }}
        />
        {colNames.map((name) => (
          <GreyCell
            key={name}
            variant="2"
            sx={{
              width: `${CELL_WIDTH}px`,
              minWidth: `${CELL_WIDTH}px`,
              maxWidth: `${CELL_WIDTH}px`,
              marginLeft: `-${CELL_BORDER_WIDTH}px`,
              "& .content": { justifyContent: "center" },
            }}
          >
            {name}
          </GreyCell>
        ))}
      </Box>
      {address &&
        appStatus.sheets[address] &&
        !appStatus.sheets[address].loading &&
        cells &&
        cells.length === GRID_SIZE &&
        Array.from(Array(N_ROW).keys()).map((rowIndex) => (
          <Box
            key={rowIndex}
            sx={{ display: "flex", marginTop: `-${CELL_BORDER_WIDTH}px` }}
          >
            <GreyCell
              variant="2"
              sx={{
                width: `${CELL_WIDTH}px`,
                minWidth: `${CELL_WIDTH}px`,
                maxWidth: `${CELL_WIDTH}px`,
                position: "sticky",
                left: 0,
                zIndex: 0,
                "& .content": { justifyContent: "center" },
              }}
            >
              {rowIndex + 1}
            </GreyCell>
            {colNames.map((name, colIndex) => {
              const cell = cells[colIndex + N_COL * rowIndex];
              return (
                <ComputedCell key={`${name}${rowIndex + 1}`} cell={cell} />
              );
            })}
          </Box>
        ))}
    </Box>
  );
};

SheetTable.defaultProps = {
  sx: {
    zIndex: 0,
    marginTop: `-${CELL_BORDER_WIDTH}px`,
    marginBottom: `-${CELL_BORDER_WIDTH}px`,
    overflow: "auto",
    flex: 1,
    "&::-webkit-scrollbar": {
      width: `${CELL_HEIGHT}px`,
      height: `${CELL_HEIGHT}px`,
      backgroundColor: "#C6D2E4",
      border: `${CELL_BORDER_WIDTH}px solid black`,
      boxShadow: `inset -5px -5px 3px #DCE3ED, inset 5px 5px 3px #949EAC`,
    },
    "&::-webkit-scrollbar-thumb": {
      backgroundColor: "#C6D2E4",
      border: `${CELL_BORDER_WIDTH}px solid black`,
      boxShadow: `inset 5px 5px 3px #DCE3ED, inset -5px -5px 3px #949EAC`,
      cursor: "pointer",
    },
    "&::-webkit-scrollbar-corner": {
      backgroundColor: "#C6D2E4",
      border: `${CELL_BORDER_WIDTH}px solid black`,
      boxShadow: `inset 5px 5px 3px #DCE3ED, inset -5px -5px 3px #949EAC`,
    },
  },
};

// export default withStaticValueFromContext(SheetTable);
export default SheetTable;
