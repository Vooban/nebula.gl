/* eslint-disable prettier/prettier */
// import turfCentroid from '@turf/centroid';
import turfCenterOfMass from '@turf/center-of-mass';
// import turfCenter from '@turf/center';
import turfBearing from '@turf/bearing';
import turfDistance from '@turf/distance';
import turfLineSlice from '@turf/line-slice';
import { coordEach } from '@turf/meta';
import { getGeom } from '@turf/invariant';
// import { point, featureCollection, lineString } from '@turf/helpers';
import { point, lineString, featureCollection, Feature } from '@turf/helpers';
import turfTransformRotate from '@turf/transform-rotate';
import polygonToLine from '@turf/polygon-to-line';
import {
  PointerMoveEvent,
  StartDraggingEvent,
  StopDraggingEvent,
  DraggingEvent,
  ModeProps,
  EditHandleFeature,
  GuideFeatureCollection,
} from '../types';
import { getPickedEditHandle } from '../utils';
import { FeatureCollection, Position } from '../geojson-types';
import { GeoJsonEditMode, GeoJsonEditAction, getIntermediatePosition } from './geojson-edit-mode';
// import { GeoJsonEditMode, GeoJsonEditAction } from './geojson-edit-mode';
import { ImmutableFeatureCollection } from './immutable-feature-collection';

export class RotateMode extends GeoJsonEditMode {
  _selectedEditHandle: EditHandleFeature | null | undefined;
  _geometryBeingRotated: FeatureCollection | null | undefined;
  _isRotating = false;
  _bearing = 0;

  _isSinglePointGeometrySelected = (geometry: FeatureCollection | null | undefined): boolean => {
    const { features } = geometry || {};
    if (Array.isArray(features) && features.length === 1) {
      // @ts-ignore
      const { type } = getGeom(features[0]);
      return type === 'Point';
    }
    return false;
  };

  _isSingleGeometrySelected = (geometry: FeatureCollection | null | undefined): boolean => {
    const { features } = geometry || {};
    return Array.isArray(features) && features.length === 1;
  };

  getIsRotating = () => this._isRotating;

  getGuides(props: ModeProps<FeatureCollection>): GuideFeatureCollection {
    const selectedGeometry =
      this._geometryBeingRotated || this.getSelectedFeaturesAsFeatureCollection(props);

    this._bearing =
      (selectedGeometry.features.length && props.modeConfig.bearing && props.viewState?.bearing) ||
      0;

    if (this._isSinglePointGeometrySelected(selectedGeometry)) {
      return { type: 'FeatureCollection', features: [] };
    }

    if (this._isRotating) {
      // Display rotate pivot
      return featureCollection([turfCenterOfMass(selectedGeometry)]) as GuideFeatureCollection;
    }

    const boundingBox = this.getSelectedFeaturesAsBoxBindedToViewBearing(props);

    // if (this._isSingleGeometrySelected(selectedGeometry)) {
    // boundingBox = selectedGeometry.features[0] as Feature<Polygon>;
    // } else
    // if (this._bearing) {
    //   const geometry = {
    //     ...selectedGeometry,
    //     features: selectedGeometry.features.map((f) => {
    //       const pivot = turfCenterOfMass(f.geometry);
    //       return { ...f, geometry: turfTransformRotate(f.geometry, -this._bearing, { pivot }) };
    //     }),
    //   };
    //   const box = bboxPolygon(bbox(geometry));
    //   const centroid = turfCenterOfMass(geometry);
    //   boundingBox = turfTransformRotate(box, this._bearing, { pivot: centroid });
    // }

    const { rotateHandle, rotateLine } = getRotateHandlers(boundingBox);

    // @ts-ignore
    return featureCollection([
      // @ts-ignore
      polygonToLine(boundingBox),
      // @ts-ignore
      rotateHandle,
      // @ts-ignore
      rotateLine,
    ]);
  }

  handleDragging(event: DraggingEvent, props: ModeProps<FeatureCollection>) {
    if (!this._isRotating) {
      return;
    }

    const rotateAction = this.getRotateAction(
      event.pointerDownMapCoords,
      event.mapCoords,
      'rotating',
      props
    );
    if (rotateAction) {
      props.onEdit(rotateAction);
    }

    event.cancelPan();
  }

  handlePointerMove(event: PointerMoveEvent, props: ModeProps<FeatureCollection>) {
    if (!this._isRotating) {
      const selectedEditHandle = getPickedEditHandle(event.picks);
      this._selectedEditHandle =
        selectedEditHandle && selectedEditHandle.properties.editHandleType === 'rotate'
          ? selectedEditHandle
          : null;
    }

    this.updateCursor(props);
  }

  handleStartDragging(event: StartDraggingEvent, props: ModeProps<FeatureCollection>) {
    if (this._selectedEditHandle) {
      this._isRotating = true;
      this._geometryBeingRotated = this.getSelectedFeaturesAsFeatureCollection(props);
    }
  }

  handleStopDragging(event: StopDraggingEvent, props: ModeProps<FeatureCollection>) {
    if (this._isRotating) {
      // Rotate the geometry
      const rotateAction = this.getRotateAction(
        event.pointerDownMapCoords,
        event.mapCoords,
        'rotated',
        props
      );

      if (rotateAction) {
        props.onEdit(rotateAction);
      }

      this._geometryBeingRotated = null;
      this._selectedEditHandle = null;
      this._isRotating = false;
    }
  }

  updateCursor(props: ModeProps<FeatureCollection>) {
    if (this._selectedEditHandle) {
      // TODO: look at doing SVG cursors to get a better "rotate" cursor
      props.onUpdateCursor('crosshair');
    } else {
      props.onUpdateCursor(null);
    }
  }

  getRotateAction(
    startDragPoint: Position,
    currentPoint: Position,
    editType: string,
    props: ModeProps<FeatureCollection>
  ): GeoJsonEditAction | null | undefined {
    if (!this._geometryBeingRotated) {
      return null;
    }

    const centroid = turfCenterOfMass(this._geometryBeingRotated);
    const angle = getRotationAngle(
      centroid.geometry.coordinates as Position,
      startDragPoint,
      currentPoint
    );
    // @ts-ignore
    const rotatedFeatures: FeatureCollection = turfTransformRotate(
      // @ts-ignore
      this._geometryBeingRotated,
      angle,
      {
        pivot: centroid,
      }
    );

    let updatedData = new ImmutableFeatureCollection(props.data);

    const selectedIndexes = props.selectedIndexes;
    for (let i = 0; i < selectedIndexes.length; i++) {
      const selectedIndex = selectedIndexes[i];
      const movedFeature = rotatedFeatures.features[i];
      updatedData = updatedData.replaceGeometry(selectedIndex, movedFeature.geometry);
    }

    return {
      updatedData: updatedData.getObject(),
      editType,
      editContext: {
        featureIndexes: selectedIndexes,
      },
    };
  }
}

function getRotateHandlers(boundingBox: Feature) {
  let topEdgeMidpointCoords = null;
  let topEdgeCoords = [];
  let previousCoord = null;
  let longestEdgeLength = 0;

  coordEach(boundingBox, (coord) => {
    if (previousCoord) {
      // @ts-ignore
      const edgeMidpoint = getIntermediatePosition(coord, previousCoord);
      if (!topEdgeMidpointCoords || edgeMidpoint[1] > topEdgeMidpointCoords[1]) {
        // Get the top edge midpoint of the enveloping box
        topEdgeMidpointCoords = edgeMidpoint;
        topEdgeCoords = [coord, previousCoord];
      }
      // Get the length of the longest edge of the enveloping box
      const edgeDistance = turfDistance(coord, previousCoord);
      longestEdgeLength = Math.max(longestEdgeLength, edgeDistance);
    }
    previousCoord = coord;
  });

  const topEdgePerpendicular = turfTransformRotate(lineString(topEdgeCoords), -90, {
    pivot: topEdgeMidpointCoords,
  });
  const rotateLineLength = longestEdgeLength / 1000;
  const rotateLine = turfLineSlice(
    topEdgeMidpointCoords,
    [topEdgeMidpointCoords[0], topEdgeMidpointCoords[1] + rotateLineLength],
    topEdgePerpendicular
  );

  let rotateHandle = point(rotateLine.geometry.coordinates[1], {
    guideType: 'editHandle',
    editHandleType: 'rotate',
  });

  return {
    rotateHandle,
    rotateLine: rotateLine,
  };
}

function getRotationAngle(centroid: Position, startDragPoint: Position, currentPoint: Position) {
  const bearing1 = turfBearing(centroid, startDragPoint);
  const bearing2 = turfBearing(centroid, currentPoint);
  return bearing2 - bearing1;
}
